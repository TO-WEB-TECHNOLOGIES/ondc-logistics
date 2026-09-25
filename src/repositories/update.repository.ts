import { and, eq } from "drizzle-orm";
import { db1 } from "../db/index.js";
import { logisticsOrder, ondcTransactions, tagValues, tags } from "../db/schema/index.js";
import type { OndcTag } from "../types/search/ondc.js";
import type { UpdateType } from "../types/update/internal.js";
import type {
  OndcOnUpdateResponse,
  OndcUpdateOrder,
  OndcUpdateRequest,
} from "../types/update/ondc.js";
import {
  loadFulfillmentTags as loadFulfillmentTagsShared,
  loadLogisticsOrder,
  type LogisticsOrderRow,
  type Tx,
} from "./logistics-order-shared.js";
import { clientStreamManager } from "../utils/streams/client-stream.js";
import type { CallbackStream } from "../utils/streams/callback-stream.js";

export type { LogisticsOrderRow };
export type UpdateCallbackResult =
  "processed" | "duplicate" | "not_found" | "invalid_order" | "invalid_bpp";

const numeric = (v: unknown): string | undefined =>
  v === undefined || v === null ? undefined : String(v);

/**
 * Persists the DB-side effect of one /update call. Derived from the
 * already-built ONDC payload (not re-derived from the raw app request) so
 * what's stored always matches exactly what was sent to the LSP — no
 * separate defaulting logic (e.g. authorization's default validity window)
 * to keep in sync between the wire payload and the DB row.
 */
const applyUpdate = async (
  tx: Tx,
  updateType: UpdateType,
  orderId: string,
  order: OndcUpdateOrder,
) => {
  const now = new Date();
  const fulfillment = order.fulfillments[0] as any;

  switch (updateType) {
    case "LINKED_ORDER_DETAILS": {
      const linked = order["@ondc/org/linked_order"] as any;
      const item = linked?.items?.[0];
      const retail = linked?.order;
      await tx
        .update(logisticsOrder)
        .set({
          linkedOrderRetailOrderId: retail?.id,
          linkedOrderProductName: item?.descriptor?.name,
          linkedOrderQuantityCount: item?.quantity?.count,
          linkedOrderWeightUnit: retail?.weight?.unit,
          linkedOrderWeightValue: numeric(retail?.weight?.value),
          linkedOrderLengthUnit: retail?.dimensions?.length?.unit,
          linkedOrderLengthValue: numeric(retail?.dimensions?.length?.value),
          linkedOrderBreadthUnit: retail?.dimensions?.breadth?.unit,
          linkedOrderBreadthValue: numeric(retail?.dimensions?.breadth?.value),
          linkedOrderHeightUnit: retail?.dimensions?.height?.unit,
          linkedOrderHeightValue: numeric(retail?.dimensions?.height?.value),
          linkedOrderProviderName: linked?.provider?.descriptor?.name,
          updatedAt: now,
        })
        .where(eq(logisticsOrder.orderId, orderId));
      return;
    }
    case "START_INSTRUCTION":
    case "END_INSTRUCTION": {
      const side = updateType === "START_INSTRUCTION" ? "start" : "end";
      const instructions = fulfillment?.[side]?.instructions;
      await tx
        .update(logisticsOrder)
        .set(
          side === "start"
            ? {
                startInstructionCode: instructions?.code,
                startInstructionShortDesc: instructions?.short_desc,
                startInstructionLongDesc: instructions?.long_desc,
                startInstructionImages: instructions?.images,
                updatedAt: now,
              }
            : {
                endInstructionCode: instructions?.code,
                endInstructionShortDesc: instructions?.short_desc,
                endInstructionLongDesc: instructions?.long_desc,
                endInstructionImages: instructions?.images,
                updatedAt: now,
              },
        )
        .where(eq(logisticsOrder.orderId, orderId));
      return;
    }
    case "START_AUTHENTICATION":
    case "END_AUTHENTICATION": {
      const side = updateType === "START_AUTHENTICATION" ? "start" : "end";
      const auth = fulfillment?.[side]?.authorization;
      const validFrom = auth?.valid_from ? new Date(auth.valid_from) : undefined;
      const validTo = auth?.valid_to ? new Date(auth.valid_to) : undefined;
      await tx
        .update(logisticsOrder)
        .set(
          side === "start"
            ? {
                startAuthorizationType: auth?.type,
                startAuthorizationToken: auth?.token,
                startAuthorizationValidFrom: validFrom,
                startAuthorizationValidTo: validTo,
                updatedAt: now,
              }
            : {
                endAuthorizationType: auth?.type,
                endAuthorizationToken: auth?.token,
                endAuthorizationValidFrom: validFrom,
                endAuthorizationValidTo: validTo,
                updatedAt: now,
              },
        )
        .where(eq(logisticsOrder.orderId, orderId));
      return;
    }
    case "READY_TO_SHIP": {
      // Replace any prior "state" tag rather than leaving stale values.
      await tx
        .delete(tags)
        .where(and(eq(tags.logisticsOrderId, orderId), eq(tags.code, "state")));
      const [tagRow] = await tx
        .insert(tags)
        .values({ logisticsOrderId: orderId, code: "state" })
        .returning({ id: tags.id });
      await tx
        .insert(tagValues)
        .values({ tagId: tagRow.id, code: "ready_to_ship", value: "yes" });
      await tx
        .update(logisticsOrder)
        .set({ updatedAt: now })
        .where(eq(logisticsOrder.orderId, orderId));
      return;
    }
  }
};

export interface UpdateRepository {
  loadOrder(orderId: string): Promise<LogisticsOrderRow | undefined>;
  /** Currently stored order/fulfillment tags (e.g. state/ready_to_ship) for this order. */
  loadFulfillmentTags(orderId: string): Promise<OndcTag[]>;
  create(
    payload: OndcUpdateRequest,
    updateType: UpdateType,
  ): Promise<boolean>;
  updateStatus(
    transactionId: string,
    messageId: string,
    status: string,
    error?: { code?: string; message?: string },
  ): Promise<void>;
  handleCallback(
    response: OndcOnUpdateResponse,
    stream?: CallbackStream,
  ): Promise<UpdateCallbackResult>;
}

export class DrizzleUpdateRepository implements UpdateRepository {
  constructor(private readonly database: typeof db1 = db1) {}

  async loadOrder(orderId: string) {
    return loadLogisticsOrder(this.database, orderId);
  }

  async loadFulfillmentTags(orderId: string): Promise<OndcTag[]> {
    return loadFulfillmentTagsShared(this.database, orderId);
  }

  async create(payload: OndcUpdateRequest, updateType: UpdateType) {
    const existing = await this.database
      .select({ id: ondcTransactions.id })
      .from(ondcTransactions)
      .where(
        and(
          eq(ondcTransactions.transactionId, payload.context.transaction_id),
          eq(ondcTransactions.messageId, payload.context.message_id),
          eq(ondcTransactions.action, "update"),
          eq(ondcTransactions.orderId, payload.message.order.id),
        ),
      )
      .limit(1);
    if (existing.length > 0) return false;

    console.log("[update.repository] persisting /update", {
      orderId: payload.message.order.id,
      transactionId: payload.context.transaction_id,
      messageId: payload.context.message_id,
      updateType,
    });
    await this.database.transaction(async (tx) => {
      await tx.insert(ondcTransactions).values({
        transactionId: payload.context.transaction_id,
        messageId: payload.context.message_id,
        action: "update",
        orderId: payload.message.order.id,
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
      await applyUpdate(tx, updateType, payload.message.order.id, payload.message.order);
    });
    return true;
  }

  async updateStatus(
    transactionId: string,
    messageId: string,
    status: string,
    error?: { code?: string; message?: string },
  ) {
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
          eq(ondcTransactions.messageId, messageId),
          eq(ondcTransactions.action, "update"),
        ),
      );
  }

  async handleCallback(
    response: OndcOnUpdateResponse,
    stream: CallbackStream = clientStreamManager,
  ) {
    const c = response.context;
    const incomingOrderId = response.message?.order?.id as string | undefined;
    console.log("[update.repository] looking up /on_update", {
      transactionId: c.transaction_id,
      messageId: c.message_id,
      bppId: c.bpp_id,
      incomingOrderId,
      hasError: Boolean(response.error),
    });
    // Per contract, /on_update reuses the /update request's message_id
    // as-is (unlike /on_confirm, which mints its own) — so the pending
    // update row is matched directly by (transaction_id, action, message_id).
    const [row] = await this.database
      .select({
        id: ondcTransactions.id,
        orderId: ondcTransactions.orderId,
        callbackTimestamp: ondcTransactions.callbackTimestamp,
        bppId: ondcTransactions.bppId,
      })
      .from(ondcTransactions)
      .where(
        and(
          eq(ondcTransactions.transactionId, c.transaction_id),
          eq(ondcTransactions.action, "update"),
          eq(ondcTransactions.messageId, c.message_id),
        ),
      )
      .limit(1);
    if (!row) {
      console.log("[update.repository] update transaction not found", {
        transactionId: c.transaction_id,
        messageId: c.message_id,
      });
      return "not_found";
    }
    if (row.callbackTimestamp) {
      console.log("[update.repository] duplicate /on_update callback", {
        transactionId: c.transaction_id,
        messageId: c.message_id,
      });
      return "duplicate";
    }
    if (row.bppId && c.bpp_id && row.bppId !== c.bpp_id) {
      console.log("[update.repository] /on_update bpp_id mismatch", {
        transactionId: c.transaction_id,
        expectedBppId: row.bppId,
        receivedBppId: c.bpp_id,
      });
      return "invalid_bpp";
    }
    if (
      !response.error &&
      row.orderId &&
      incomingOrderId &&
      incomingOrderId !== row.orderId
    ) {
      console.log("[update.repository] /on_update order.id mismatch", {
        transactionId: c.transaction_id,
        expectedOrderId: row.orderId,
        receivedOrderId: incomingOrderId,
      });
      return "invalid_order";
    }

    const orderState = response.error
      ? "failed"
      : ((response.message?.order as any)?.state ?? "unknown");
    let updatedFields: { state?: string; awbNo?: string } | undefined;
    await this.database.transaction(async (tx) => {
      if (!response.error && response.message?.order && row.orderId) {
        // /on_update carries whatever state/fulfillment fields the LSP
        // confirms — persist state and a fresh AWB if one comes back;
        // deeper fields (e.g. weight-differential tags) are auto-ACKed
        // and not yet parsed further here (see implementation plan).
        const order = response.message.order as any;
        const fulfillment = order.fulfillments?.[0];
        updatedFields = {
          state: order.state as string | undefined,
          awbNo: fulfillment?.["@ondc/org/awb_no"] as string | undefined,
        };
        await tx
          .update(logisticsOrder)
          .set({
            bppId: c.bpp_id,
            bppUri: c.bpp_uri,
            ...(order.state ? { state: order.state } : {}),
            ...(fulfillment?.["@ondc/org/awb_no"]
              ? { awbNo: fulfillment["@ondc/org/awb_no"] }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(logisticsOrder.orderId, row.orderId));
      }
      await tx
        .update(ondcTransactions)
        .set({
          status: response.error ? "failed" : "completed",
          orderState,
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

    if (response.error) {
      stream.push(c.transaction_id, "update_error", {
        orderId: row.orderId,
        code: response.error.code,
        message: response.error.message,
      });
    } else {
      stream.push(c.transaction_id, "order_updated", {
        orderId: row.orderId,
        state: updatedFields?.state,
        awbNo: updatedFields?.awbNo,
        updatedAt: new Date().toISOString(),
      });
    }

    console.log("[update.repository] /on_update persisted", {
      transactionId: c.transaction_id,
      orderId: row.orderId,
      orderState,
    });
    return "processed";
  }
}
