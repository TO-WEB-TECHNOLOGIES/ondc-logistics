import { and, eq } from "drizzle-orm";
import { db1 } from "../db/index.js";
import { logisticsOrder, ondcTransactions } from "../db/schema/index.js";
import { buildOndcInitOrder } from "../mappers/init-persistence.mapper.js";
import {
  buildLogisticsOrderColumns,
  syncLogisticsOrderTags,
  type AnyOrder,
} from "./logistics-order-shared.js";
import { fetchInitOrderSnapshot } from "./init-order-reader.js";
import { clientStreamManager } from "../utils/streams/client-stream.js";
import type { CallbackStream } from "../utils/streams/callback-stream.js";
import type {
  OndcConfirmRequest,
  OndcOnConfirmResponse,
} from "../types/confirm/ondc.js";
import type {
  OndcInitRequest,
  OndcOnInitResponse,
} from "../types/init/ondc.js";

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
    stream?: CallbackStream,
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

      // order.id is reused across /confirm retries for the same
      // initTransactionId (see loadInitialized's existingOrder lookup), but
      // message_id is always fresh (no caller-pinned override), so the
      // dedupe check above never matches on retry. Upsert on the order_id
      // primary key instead of a bare insert so a retry (e.g. resending
      // /confirm after fixing a prior NACK) refreshes the row with the
      // latest attempt's data rather than crashing on a duplicate key.
      const order = payload.message.order as unknown as AnyOrder;
      const logisticsOrderValues = {
        orderId: order.id,
        transactionId: payload.context.transaction_id,
        bppId: payload.context.bpp_id,
        bppUri: payload.context.bpp_uri,
        ...buildLogisticsOrderColumns(order),
      };
      await tx
        .insert(logisticsOrder)
        .values(logisticsOrderValues)
        .onConflictDoUpdate({
          target: logisticsOrder.orderId,
          set: { ...logisticsOrderValues, updatedAt: new Date() },
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
  async handleCallback(
    response: OndcOnConfirmResponse,
    stream: CallbackStream = clientStreamManager,
  ) {
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
        messageId: ondcTransactions.messageId,
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
    // Contract correlates /on_confirm to /confirm by order_id, and a 63002
    // NACK makes the LSP cancel the order (reason 997) — so a message_id that
    // doesn't echo our /confirm is logged, never NACKed.
    if (row.messageId !== c.message_id)
      console.log("[confirm.repository] /on_confirm message_id differs from /confirm", {
        transactionId: c.transaction_id,
        confirmMessageId: row.messageId,
        callbackMessageId: c.message_id,
      });
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
    let columns: ReturnType<typeof buildLogisticsOrderColumns> | undefined;
    await this.database.transaction(async (tx) => {
      if (!response.error && response.message?.order && row.orderId) {
        // Full replace of the flattened columns with the BPP's returned
        // order — the contract's /on_confirm carries the complete order
        // object, so this is the authoritative state going forward.
        const order = response.message.order as unknown as AnyOrder;
        columns = buildLogisticsOrderColumns(order);
        await tx
          .update(logisticsOrder)
          .set({
            bppId: c.bpp_id,
            bppUri: c.bpp_uri,
            ...columns,
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

    if (response.error) {
      stream.push(c.transaction_id, "confirm_error", {
        orderId: row.orderId,
        code: response.error.code,
        message: response.error.message,
      });
    } else if (row.orderId) {
      stream.push(c.transaction_id, "order_confirmed", {
        orderId: row.orderId,
        state: columns?.state,
        providerId: columns?.providerId,
        item: {
          itemId: columns?.itemId,
          name: columns?.itemDescriptorName,
          quantityCount: columns?.itemQuantityCount,
        },
        fulfillment: {
          fulfillmentId: columns?.fulfillmentId,
          type: columns?.fulfillmentType,
          state: columns?.fulfillmentStateCode,
          awbNo: columns?.awbNo,
        },
        quote: {
          priceAmount: columns?.quotePriceAmount,
          priceCurrency: columns?.quotePriceCurrency,
        },
        billing: {
          name: columns?.billingName,
          email: columns?.billingEmail,
          phone: columns?.billingPhone,
        },
        payment: {
          type: columns?.paymentType,
          collectedBy: columns?.paymentCollectedBy,
        },
      });
    }

    console.log("[confirm.repository] /on_confirm persisted", {
      transactionId: c.transaction_id,
      orderId: row.orderId,
      state,
    });
    return "processed";
  }
}
