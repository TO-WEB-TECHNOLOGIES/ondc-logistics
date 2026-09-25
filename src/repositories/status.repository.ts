import { and, eq } from "drizzle-orm";
import { db1 } from "../db/index.js";
import { logisticsOrder, ondcTransactions } from "../db/schema/index.js";
import { orderSseManager } from "../utils/streams/order-sse.js";
import { clientStreamManager } from "../utils/streams/client-stream.js";
import type { CallbackStream } from "../utils/streams/callback-stream.js";
import {
  buildLogisticsOrderColumns,
  loadLogisticsOrder,
  syncLogisticsOrderTags,
  type AnyOrder,
  type LogisticsOrderRow,
} from "./logistics-order-shared.js";
import type { OndcOnStatusResponse, OndcStatusRequest } from "../types/status/ondc.js";

export type StatusCallbackResult = "processed" | "not_found" | "invalid_bpp";

export interface StatusRepository {
  loadOrder(orderId: string): Promise<LogisticsOrderRow | undefined>;
  create(payload: OndcStatusRequest): Promise<boolean>;
  updateStatus(
    transactionId: string,
    messageId: string,
    status: string,
    error?: { code?: string; message?: string },
  ): Promise<void>;
  handleCallback(
    response: OndcOnStatusResponse,
    stream?: CallbackStream,
  ): Promise<StatusCallbackResult>;
}

export class DrizzleStatusRepository implements StatusRepository {
  constructor(private readonly database: typeof db1 = db1) {}

  async loadOrder(orderId: string) {
    return loadLogisticsOrder(this.database, orderId);
  }

  async create(payload: OndcStatusRequest) {
    const existing = await this.database
      .select({ id: ondcTransactions.id })
      .from(ondcTransactions)
      .where(
        and(
          eq(ondcTransactions.transactionId, payload.context.transaction_id),
          eq(ondcTransactions.messageId, payload.context.message_id),
          eq(ondcTransactions.action, "status"),
          eq(ondcTransactions.orderId, payload.message.order_id),
        ),
      )
      .limit(1);
    if (existing.length > 0) return false;

    console.log("[status.repository] persisting /status", {
      orderId: payload.message.order_id,
      transactionId: payload.context.transaction_id,
      messageId: payload.context.message_id,
    });
    await this.database.insert(ondcTransactions).values({
      transactionId: payload.context.transaction_id,
      messageId: payload.context.message_id,
      action: "status",
      orderId: payload.message.order_id,
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
          eq(ondcTransactions.action, "status"),
        ),
      );
  }

  async handleCallback(
    response: OndcOnStatusResponse,
    stream: CallbackStream = clientStreamManager,
  ) {
    const c = response.context;
    const incomingOrderId = response.message?.order?.id as string | undefined;
    console.log("[status.repository] looking up /on_status", {
      transactionId: c.transaction_id,
      messageId: c.message_id,
      bppId: c.bpp_id,
      incomingOrderId,
      hasError: Boolean(response.error),
    });

    // /on_status can be solicited or unsolicited (per contract) — correlate
    // directly by the response's order.id against logistics_order (its PK),
    // not by matching a pending outbound /status request row.
    if (!incomingOrderId) {
      console.log("[status.repository] /on_status missing order.id", {
        transactionId: c.transaction_id,
      });
      return "not_found";
    }
    const row = await loadLogisticsOrder(this.database, incomingOrderId);
    if (!row) {
      console.log("[status.repository] unknown order for /on_status", {
        transactionId: c.transaction_id,
        incomingOrderId,
      });
      return "not_found";
    }
    if (row.bppId && c.bpp_id && row.bppId !== c.bpp_id) {
      console.log("[status.repository] /on_status bpp_id mismatch", {
        transactionId: c.transaction_id,
        expectedBppId: row.bppId,
        receivedBppId: c.bpp_id,
      });
      return "invalid_bpp";
    }

    let columns: ReturnType<typeof buildLogisticsOrderColumns> | undefined;

    await this.database.transaction(async (tx) => {
      if (!response.error && response.message?.order) {
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

      // Best-effort audit link: update a pending outbound /status row for
      // this transaction if one exists; skip silently for an unsolicited
      // push (there's nothing pending to link it to).
      await tx
        .update(ondcTransactions)
        .set({
          status: response.error ? "failed" : "completed",
          callbackMessageId: c.message_id,
          callbackTimestamp: new Date(c.timestamp),
          bppId: c.bpp_id,
          bppUri: c.bpp_uri,
          errorCode: response.error?.code as string | undefined,
          errorMessage: response.error?.message as string | undefined,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(ondcTransactions.transactionId, c.transaction_id),
            eq(ondcTransactions.action, "status"),
            eq(ondcTransactions.orderId, row.orderId),
            eq(ondcTransactions.status, "sent"),
          ),
        );
    });

    if (!response.error && columns) {
      orderSseManager.publish(row.orderId, {
        event: "order_status",
        orderId: row.orderId,
        state: columns.state,
        fulfillmentState: columns.fulfillmentStateCode,
        awbNo: columns.awbNo,
        updatedAt: new Date().toISOString(),
      });
      stream.push(c.transaction_id, "order_status", {
        orderId: row.orderId,
        state: columns.state,
        fulfillmentState: columns.fulfillmentStateCode,
        awbNo: columns.awbNo,
        updatedAt: new Date().toISOString(),
      });
    } else if (response.error) {
      stream.push(c.transaction_id, "status_error", {
        orderId: row.orderId,
        code: response.error.code,
        message: response.error.message,
      });
    }

    console.log("[status.repository] /on_status persisted", {
      transactionId: c.transaction_id,
      orderId: row.orderId,
      state: columns?.state,
    });
    return "processed";
  }
}
