import { and, eq } from "drizzle-orm";
import { db1 } from "../db/index.js";
import {
  logisticsOrder,
  ondcTransactions,
  tagValues,
  tags,
} from "../db/schema/index.js";
import { buildOndcInitOrder } from "../mappers/init-persistence.mapper.js";
import { fetchInitOrderSnapshot } from "./init-order-reader.js";
import type {
  OndcConfirmRequest,
  OndcOnConfirmResponse,
} from "../types/confirm/ondc.js";
import type {
  OndcInitRequest,
  OndcOnInitResponse,
} from "../types/init/ondc.js";

type Tx = Parameters<Parameters<typeof db1.transaction>[0]>[0];
// Loosely typed: both the outbound /confirm order we build and the inbound
// /on_confirm order the BPP returns share this shape closely enough that a
// single extractor covers both (see buildLogisticsOrderColumns below).
type AnyOrder = Record<string, any>;

/**
 * Flattens the confirm/on_confirm order object into logistics_order's typed
 * columns. Single primary item/fulfillment/linked-order-item per order (see
 * logistics-order.schema.ts) — a second item/fulfillment/linked line isn't
 * representable here. Authorization token/valid_from/valid_to are
 * deliberately NOT extracted here — those are populated later by /update
 * when the frontend sends an OTP, not by /confirm|/on_confirm.
 */
const buildLogisticsOrderColumns = (order: AnyOrder) => {
  const item = Array.isArray(order.items) ? order.items[0] : undefined;
  const fulfillment = Array.isArray(order.fulfillments)
    ? order.fulfillments[0]
    : undefined;
  const linkedOrder = order["@ondc/org/linked_order"];
  const linkedItem = Array.isArray(linkedOrder?.items)
    ? linkedOrder.items[0]
    : undefined;
  const linkedRetailOrder = linkedOrder?.order;

  return {
    providerId: order.provider?.id,
    state: order.state,
    orderCreatedAt: order.created_at ? new Date(order.created_at) : undefined,
    orderUpdatedAt: order.updated_at ? new Date(order.updated_at) : undefined,

    itemId: item?.id,
    itemCategoryId: item?.category_id,
    itemDescriptorCode: item?.descriptor?.code,
    itemDescriptorName: item?.descriptor?.name,
    itemQuantityCount: item?.quantity?.count,

    fulfillmentId: fulfillment?.id,
    fulfillmentType: fulfillment?.type,
    awbNo: fulfillment?.["@ondc/org/awb_no"],

    startInstructionCode: fulfillment?.start?.instructions?.code,
    startInstructionShortDesc: fulfillment?.start?.instructions?.short_desc,
    startInstructionLongDesc: fulfillment?.start?.instructions?.long_desc,
    startInstructionImages: fulfillment?.start?.instructions?.images,
    endInstructionCode: fulfillment?.end?.instructions?.code,
    endInstructionShortDesc: fulfillment?.end?.instructions?.short_desc,
    endInstructionLongDesc: fulfillment?.end?.instructions?.long_desc,
    endInstructionImages: fulfillment?.end?.instructions?.images,

    startAuthorizationType: fulfillment?.start?.authorization?.type,
    endAuthorizationType: fulfillment?.end?.authorization?.type,

    quotePriceAmount: order.quote?.price?.value,
    quotePriceCurrency: order.quote?.price?.currency,

    billingName: order.billing?.name,
    billingEmail: order.billing?.email,
    billingPhone: order.billing?.phone,

    paymentType: order.payment?.type,
    paymentCollectedBy: order.payment?.collected_by,
    paymentCollectionAmount: order.payment?.["@ondc/org/collection_amount"],

    linkedOrderRetailOrderId: linkedRetailOrder?.id,
    linkedOrderProductName: linkedItem?.descriptor?.name,
    linkedOrderQuantityCount: linkedItem?.quantity?.count,
    linkedOrderWeightUnit: linkedRetailOrder?.weight?.unit,
    linkedOrderWeightValue: linkedRetailOrder?.weight?.value,
    linkedOrderLengthUnit: linkedRetailOrder?.dimensions?.length?.unit,
    linkedOrderLengthValue: linkedRetailOrder?.dimensions?.length?.value,
    linkedOrderBreadthUnit: linkedRetailOrder?.dimensions?.breadth?.unit,
    linkedOrderBreadthValue: linkedRetailOrder?.dimensions?.breadth?.value,
    linkedOrderHeightUnit: linkedRetailOrder?.dimensions?.height?.unit,
    linkedOrderHeightValue: linkedRetailOrder?.dimensions?.height?.value,
    linkedOrderProviderName: linkedOrder?.provider?.descriptor?.name,
  };
};

/**
 * Replaces logistics_order's tags (order-level + the primary fulfillment's
 * tags — e.g. "state"/ready_to_ship) via the shared tags/tag_values tables,
 * per logisticsOrderId. Delete-then-reinsert, same "replace prior state"
 * pattern used elsewhere in this codebase for callback-driven data.
 */
const syncLogisticsOrderTags = async (tx: Tx, orderId: string, order: AnyOrder) => {
  await tx.delete(tags).where(eq(tags.logisticsOrderId, orderId));
  const fulfillment = Array.isArray(order.fulfillments)
    ? order.fulfillments[0]
    : undefined;
  const allTags = [
    ...(Array.isArray(order.tags) ? order.tags : []),
    ...(Array.isArray(fulfillment?.tags) ? fulfillment.tags : []),
  ];
  for (const tag of allTags) {
    if (!tag?.code) continue;
    const [tagRow] = await tx
      .insert(tags)
      .values({ logisticsOrderId: orderId, code: tag.code })
      .returning({ id: tags.id });
    const list = Array.isArray(tag.list) ? tag.list : [];
    if (list.length)
      await tx
        .insert(tagValues)
        .values(list.map((v: any) => ({ tagId: tagRow.id, code: v.code, value: v.value })));
  }
};

export type ConfirmCallbackResult =
  "processed" | "duplicate" | "not_found" | "invalid_order" | "invalid_bpp";
export interface ConfirmRepository {
  loadInitialized(initTransactionId: string): Promise<{
    init: OndcInitRequest;
    onInit: OndcOnInitResponse;
    initTransactionId: string;
    orderId?: string;
  }>;
  create(
    payload: OndcConfirmRequest,
    initTransactionId: string,
  ): Promise<boolean>;
  updateStatus(
    transactionId: string,
    status: string,
    error?: { code?: string; message?: string },
  ): Promise<void>;
  handleCallback(
    response: OndcOnConfirmResponse,
  ): Promise<ConfirmCallbackResult>;
}
export class DrizzleConfirmRepository implements ConfirmRepository {
  constructor(private readonly database: typeof db1 = db1) {}
  async loadInitialized(initTransactionId: string) {
    console.log("[confirm.repository] loading initialized transaction", {
      initTransactionId,
    });
    const [row] = await this.database
      .select({
        id: ondcTransactions.id,
        transactionId: ondcTransactions.transactionId,
        messageId: ondcTransactions.messageId,
        status: ondcTransactions.status,
        domain: ondcTransactions.domain,
        country: ondcTransactions.country,
        city: ondcTransactions.city,
        coreVersion: ondcTransactions.coreVersion,
        bapId: ondcTransactions.bapId,
        bapUri: ondcTransactions.bapUri,
        bppId: ondcTransactions.bppId,
        bppUri: ondcTransactions.bppUri,
        timestamp: ondcTransactions.timestamp,
        ttl: ondcTransactions.ttl,
        callbackMessageId: ondcTransactions.callbackMessageId,
        callbackTimestamp: ondcTransactions.callbackTimestamp,
      })
      .from(ondcTransactions)
      .where(
        and(
          eq(ondcTransactions.transactionId, initTransactionId),
          eq(ondcTransactions.action, "init"),
        ),
      )
      .limit(1);
    if (!row) throw new Error("init transaction not found");

    const [initSnapshot, onInitSnapshot] = await Promise.all([
      fetchInitOrderSnapshot(this.database, row.id, "init"),
      fetchInitOrderSnapshot(this.database, row.id, "on_init"),
    ]);
    if (row.status !== "completed" || !initSnapshot || !onInitSnapshot)
      throw new Error("init transaction has no completed on_init");

    const baseContext = {
      domain: row.domain ?? "",
      country: row.country ?? "",
      city: row.city ?? "",
      core_version: row.coreVersion ?? "",
      bap_id: row.bapId ?? "",
      bap_uri: row.bapUri ?? "",
    };
    const init: OndcInitRequest = {
      context: {
        ...baseContext,
        action: "init",
        bpp_id: row.bppId ?? "",
        bpp_uri: row.bppUri ?? "",
        transaction_id: row.transactionId,
        message_id: row.messageId,
        timestamp: (row.timestamp ?? new Date()).toISOString(),
        ...(row.ttl ? { ttl: row.ttl } : {}),
      },
      message: { order: buildOndcInitOrder(initSnapshot) },
    };
    const onInit: OndcOnInitResponse = {
      context: {
        ...baseContext,
        action: "on_init",
        ...(row.bppId ? { bpp_id: row.bppId } : {}),
        ...(row.bppUri ? { bpp_uri: row.bppUri } : {}),
        transaction_id: row.transactionId,
        message_id: row.callbackMessageId ?? row.messageId,
        timestamp: (row.callbackTimestamp ?? new Date()).toISOString(),
      },
      message: { order: buildOndcInitOrder(onInitSnapshot) },
    };

    // A prior /confirm attempt for this transaction may have already minted
    // an order — reuse it instead of minting a second one on retry.
    const [existingOrder] = await this.database
      .select({ orderId: logisticsOrder.orderId })
      .from(logisticsOrder)
      .where(eq(logisticsOrder.transactionId, row.transactionId))
      .limit(1);

    console.log("[confirm.repository] initialized state loaded", {
      initTransactionId,
      status: row.status,
      existingOrderId: existingOrder?.orderId,
    });
    return {
      init,
      onInit,
      initTransactionId: row.transactionId,
      orderId: existingOrder?.orderId,
    };
  }
  async create(payload: OndcConfirmRequest, initTransactionId: string) {
    const existing = await this.database
      .select({ id: ondcTransactions.id })
      .from(ondcTransactions)
      .where(
        and(
          eq(ondcTransactions.transactionId, payload.context.transaction_id),
          eq(ondcTransactions.messageId, payload.context.message_id),
          eq(ondcTransactions.action, "confirm"),
          eq(ondcTransactions.orderId, payload.message.order.id),
        ),
      )
      .limit(1);
    if (existing.length > 0) return false;

    console.log("[confirm.repository] persisting /confirm", {
      orderId: payload.message.order.id,
      transactionId: payload.context.transaction_id,
      messageId: payload.context.message_id,
      parentTransactionId: initTransactionId,
    });
    await this.database.transaction(async (tx) => {
      await tx.insert(ondcTransactions).values({
        transactionId: payload.context.transaction_id,
        messageId: payload.context.message_id,
        action: "confirm",
        parentTransactionId: initTransactionId,
        orderId: payload.message.order.id,
        orderState: payload.message.order.state,
        status: "pending",
        domain: payload.context.domain,
        country: payload.context.country,
        city: payload.context.city,
        coreVersion: payload.context.core_version,
        bapId: payload.context.bap_id,
        bapUri: payload.context.bap_uri,
        bppId: payload.context.bpp_id,
        bppUri: payload.context.bpp_uri,
        timestamp: new Date(payload.context.timestamp),
        ttl: payload.context.ttl,
      });

      // order.id is minted fresh per attempt today (see loadInitialized), so
      // this is always a first insert for this order, not a repeat write.
      const order = payload.message.order as unknown as AnyOrder;
      await tx.insert(logisticsOrder).values({
        orderId: order.id,
        transactionId: payload.context.transaction_id,
        bppId: payload.context.bpp_id,
        bppUri: payload.context.bpp_uri,
        ...buildLogisticsOrderColumns(order),
      });
      await syncLogisticsOrderTags(tx, order.id, order);
    });
    return true;
  }
  async updateStatus(
    transactionId: string,
    status: string,
    error?: { code?: string; message?: string },
  ) {
    console.log("[confirm.repository] updating status", {
      transactionId,
      status,
      error,
    });
    await this.database
      .update(ondcTransactions)
      .set({
        status,
        errorCode: error?.code,
        errorMessage: error?.message,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(ondcTransactions.transactionId, transactionId),
          eq(ondcTransactions.action, "confirm"),
        ),
      );
  }
  async handleCallback(response: OndcOnConfirmResponse) {
    const c = response.context;
    const incomingOrderId = response.message?.order?.id;
    console.log("[confirm.repository] looking up /on_confirm", {
      transactionId: c.transaction_id,
      messageId: c.message_id,
      bppId: c.bpp_id,
      incomingOrderId,
      hasError: Boolean(response.error),
    });
    const [row] = await this.database
      .select({
        id: ondcTransactions.id,
        orderId: ondcTransactions.orderId,
        callbackMessageId: ondcTransactions.callbackMessageId,
        bppId: ondcTransactions.bppId,
      })
      .from(ondcTransactions)
      .where(
        and(
          eq(ondcTransactions.transactionId, c.transaction_id),
          eq(ondcTransactions.action, "confirm"),
          // A transaction_id can have more than one /confirm row (retries,
          // each currently minting its own order id — see loadInitialized).
          // Without matching on order id too, LIMIT 1 below can pick an
          // unrelated sibling attempt and this callback gets wrongly NACKed
          // as invalid_order even though it's legitimate for its own row.
          ...(incomingOrderId
            ? [eq(ondcTransactions.orderId, incomingOrderId)]
            : []),
        ),
      )
      .limit(1);
    if (!row) {
      console.log("[confirm.repository] confirm transaction not found", {
        transactionId: c.transaction_id,
        incomingOrderId,
      });
      return "not_found";
    }
    console.log("[confirm.repository] /on_confirm matched confirm row", {
      transactionId: c.transaction_id,
      rowId: row.id,
      rowOrderId: row.orderId,
      rowBppId: row.bppId,
      incomingOrderId,
      incomingBppId: c.bpp_id,
    });
    if (row.callbackMessageId === c.message_id) {
      console.log("[confirm.repository] duplicate /on_confirm callback", {
        transactionId: c.transaction_id,
        messageId: c.message_id,
      });
      return "duplicate";
    }
    if (row.bppId && c.bpp_id && row.bppId !== c.bpp_id) {
      console.log("[confirm.repository] /on_confirm bpp_id mismatch", {
        transactionId: c.transaction_id,
        expectedBppId: row.bppId,
        receivedBppId: c.bpp_id,
      });
      return "invalid_bpp";
    }
    if (
      !response.error &&
      row.orderId &&
      response.message?.order?.id !== row.orderId
    ) {
      console.log("[confirm.repository] /on_confirm order.id mismatch", {
        transactionId: c.transaction_id,
        expectedOrderId: row.orderId,
        receivedOrderId: response.message?.order?.id,
      });
      return "invalid_order";
    }
    const state = response.error
      ? "failed"
      : (response.message?.order?.state ?? "unknown");
    await this.database.transaction(async (tx) => {
      if (!response.error && response.message?.order && row.orderId) {
        // Full replace of the flattened columns with the BPP's returned
        // order — the contract's /on_confirm carries the complete order
        // object, so this is the authoritative state going forward.
        const order = response.message.order as unknown as AnyOrder;
        await tx
          .update(logisticsOrder)
          .set({
            bppId: c.bpp_id,
            bppUri: c.bpp_uri,
            ...buildLogisticsOrderColumns(order),
            updatedAt: new Date(),
          })
          .where(eq(logisticsOrder.orderId, row.orderId));
        await syncLogisticsOrderTags(tx, row.orderId, order);
      }
      await tx
        .update(ondcTransactions)
        .set({
          status: response.error ? "failed" : "completed",
          orderState: state,
          callbackMessageId: c.message_id,
          callbackTimestamp: new Date(c.timestamp),
          bppId: c.bpp_id,
          bppUri: c.bpp_uri,
          errorCode: response.error?.code as string | undefined,
          errorMessage: response.error?.message as string | undefined,
          updatedAt: new Date(),
        })
        .where(eq(ondcTransactions.id, row.id));
    });
    console.log("[confirm.repository] /on_confirm persisted", {
      transactionId: c.transaction_id,
      orderId: row.orderId,
      state,
    });
    return "processed";
  }
}
