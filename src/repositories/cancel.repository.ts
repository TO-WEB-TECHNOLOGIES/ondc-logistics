import { and, eq } from "drizzle-orm";
import { db1 } from "../db/index.js";
import { logisticsOrder, ondcTransactions } from "../db/schema/index.js";
import { orderSseManager } from "../utils/streams/order-sse.js";
import { clientStreamManager } from "../utils/streams/client-stream.js";
import { getCancellationReasonText } from "../constants/cancellation-reason-codes.js";
import {
  buildLogisticsOrderColumns,
  loadLogisticsOrder,
  syncLogisticsOrderTags,
  type AnyOrder,
  type LogisticsOrderRow,
} from "./logistics-order-shared.js";
import type { OndcCancelRequest, OndcOnCancelResponse } from "../types/cancel/ondc.js";

export type CancelCallbackResult =
  | "processed"
  | "duplicate"
  | "not_found"
  | "invalid_bpp"
  | "invalid_order";

export interface CancelRepository {
  loadOrder(orderId: string): Promise<LogisticsOrderRow | undefined>;
  create(payload: OndcCancelRequest): Promise<boolean>;
  /** Also mirrors the attempt onto logistics_order.cancellationStatus ("pending"/"failed") — see schema comment. */
  updateStatus(
    transactionId: string,
    messageId: string,
    orderId: string,
    status: string,
    error?: { code?: string; message?: string },
  ): Promise<void>;
  handleCallback(response: OndcOnCancelResponse): Promise<CancelCallbackResult>;
}

export class DrizzleCancelRepository implements CancelRepository {
  constructor(private readonly database: typeof db1 = db1) {}

  async loadOrder(orderId: string) {
    return loadLogisticsOrder(this.database, orderId);
  }

  async create(payload: OndcCancelRequest) {
    const existing = await this.database
      .select({ id: ondcTransactions.id })
      .from(ondcTransactions)
      .where(
        and(
          eq(ondcTransactions.transactionId, payload.context.transaction_id),
          eq(ondcTransactions.messageId, payload.context.message_id),
          eq(ondcTransactions.action, "cancel"),
          eq(ondcTransactions.orderId, payload.message.order_id),
        ),
      )
      .limit(1);
    if (existing.length > 0) return false;

    console.log("[cancel.repository] persisting /cancel", {
      orderId: payload.message.order_id,
      transactionId: payload.context.transaction_id,
      messageId: payload.context.message_id,
      cancellationReasonId: payload.message.cancellation_reason_id,
    });
    await this.database.insert(ondcTransactions).values({
      transactionId: payload.context.transaction_id,
      messageId: payload.context.message_id,
      action: "cancel",
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
    orderId: string,
    status: string,
    error?: { code?: string; message?: string },
  ) {
    await this.database.transaction(async (tx) => {
      await tx
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
            eq(ondcTransactions.action, "cancel"),
          ),
        );

      // Mirror the send attempt onto logistics_order — NOT "Cancelled"/"succeeded"
      // yet, only "pending" (sent, awaiting /on_cancel) or "failed" (never left
      // this app). The only place cancellationStatus becomes "succeeded" is
      // handleCallback, once /on_cancel actually confirms it.
      if (status === "sent" || status === "failed") {
        await tx
          .update(logisticsOrder)
          .set({
            cancellationStatus: status === "sent" ? "pending" : "failed",
            updatedAt: new Date(),
          })
          .where(eq(logisticsOrder.orderId, orderId));
      }
    });
  }

  async handleCallback(response: OndcOnCancelResponse) {
    const c = response.context;
    const order = response.message?.order as AnyOrder | undefined;
    const incomingOrderId = order?.id as string | undefined;
    console.log("[cancel.repository] looking up /on_cancel", {
      transactionId: c.transaction_id,
      messageId: c.message_id,
      bppId: c.bpp_id,
      incomingOrderId,
      hasError: Boolean(response.error),
    });

    // Solicited path: this /on_cancel is a reply to OUR /cancel — the LSP
    // echoes back the same message_id, same as /on_update does.
    const [pending] = await this.database
      .select({
        orderId: ondcTransactions.orderId,
        callbackTimestamp: ondcTransactions.callbackTimestamp,
        bppId: ondcTransactions.bppId,
      })
      .from(ondcTransactions)
      .where(
        and(
          eq(ondcTransactions.transactionId, c.transaction_id),
          eq(ondcTransactions.action, "cancel"),
          eq(ondcTransactions.messageId, c.message_id),
        ),
      )
      .limit(1);

    let orderId: string | undefined;
    let isNewUnsolicitedRow = false;

    if (pending) {
      if (pending.callbackTimestamp) {
        console.log("[cancel.repository] duplicate solicited /on_cancel callback", {
          transactionId: c.transaction_id,
          messageId: c.message_id,
        });
        return "duplicate" as const;
      }
      if (pending.bppId && c.bpp_id && pending.bppId !== c.bpp_id) {
        console.log("[cancel.repository] /on_cancel bpp_id mismatch", {
          transactionId: c.transaction_id,
          expectedBppId: pending.bppId,
          receivedBppId: c.bpp_id,
        });
        return "invalid_bpp" as const;
      }
      if (
        !response.error &&
        pending.orderId &&
        incomingOrderId &&
        incomingOrderId !== pending.orderId
      ) {
        console.log("[cancel.repository] /on_cancel order.id mismatch", {
          transactionId: c.transaction_id,
          expectedOrderId: pending.orderId,
          receivedOrderId: incomingOrderId,
        });
        return "invalid_order" as const;
      }
      orderId = pending.orderId ?? undefined;
    } else {
      // Unsolicited path: LSP cancels directly — no outbound /cancel of ours
      // to match, so correlate straight off the order id (same fallback
      // /on_status already uses for LSP-pushed updates).
      if (!incomingOrderId) {
        console.log("[cancel.repository] /on_cancel missing order.id and no matching /cancel request", {
          transactionId: c.transaction_id,
        });
        return "not_found" as const;
      }
      const row = await loadLogisticsOrder(this.database, incomingOrderId);
      if (!row) {
        console.log("[cancel.repository] unknown order for unsolicited /on_cancel", {
          transactionId: c.transaction_id,
          incomingOrderId,
        });
        return "not_found" as const;
      }
      if (row.bppId && c.bpp_id && row.bppId !== c.bpp_id) {
        console.log("[cancel.repository] unsolicited /on_cancel bpp_id mismatch", {
          transactionId: c.transaction_id,
          expectedBppId: row.bppId,
          receivedBppId: c.bpp_id,
        });
        return "invalid_bpp" as const;
      }
      // Dedupe a resend of the same unsolicited push: the audit row inserted
      // below on first delivery will already exist on a retry.
      const [existingAudit] = await this.database
        .select({ id: ondcTransactions.id })
        .from(ondcTransactions)
        .where(
          and(
            eq(ondcTransactions.transactionId, c.transaction_id),
            eq(ondcTransactions.messageId, c.message_id),
            eq(ondcTransactions.action, "cancel"),
          ),
        )
        .limit(1);
      if (existingAudit) {
        console.log("[cancel.repository] duplicate unsolicited /on_cancel callback", {
          transactionId: c.transaction_id,
          messageId: c.message_id,
        });
        return "duplicate" as const;
      }
      orderId = row.orderId;
      isNewUnsolicitedRow = true;
    }

    if (!orderId) {
      console.log("[cancel.repository] /on_cancel had no resolvable order id", {
        transactionId: c.transaction_id,
      });
      return "not_found" as const;
    }
    const resolvedOrderId = orderId;

    // Only "no error AND order.state === Cancelled" counts as an actually
    // confirmed cancellation — this is the one condition allowed to flip
    // logistics_order.state / cancellationStatus.
    const confirmed = !response.error && order?.state === "Cancelled";
    let columns: ReturnType<typeof buildLogisticsOrderColumns> | undefined;

    await this.database.transaction(async (tx) => {
      if (isNewUnsolicitedRow) {
        await tx.insert(ondcTransactions).values({
          transactionId: c.transaction_id,
          messageId: c.message_id,
          action: "cancel",
          orderId: resolvedOrderId,
          status: response.error ? "failed" : "completed",
          orderState: response.error ? "failed" : (order?.state as string | undefined),
          domain: c.domain,
          country: c.country,
          city: c.city,
          coreVersion: c.core_version,
          bapId: c.bap_id,
          bapUri: c.bap_uri,
          bppId: c.bpp_id,
          bppUri: c.bpp_uri,
          timestamp: new Date(c.timestamp),
          callbackMessageId: c.message_id,
          callbackTimestamp: new Date(c.timestamp),
          errorCode: response.error?.code as string | undefined,
          errorMessage: response.error?.message as string | undefined,
        });
      } else {
        await tx
          .update(ondcTransactions)
          .set({
            status: response.error ? "failed" : "completed",
            orderState: response.error ? "failed" : (order?.state as string | undefined),
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
              eq(ondcTransactions.action, "cancel"),
              eq(ondcTransactions.messageId, c.message_id),
            ),
          );
      }

      if (response.error) {
        // LSP rejected/NACK'd the cancellation (e.g. invalid reason = 60009,
        // TAT not breached = 60010) — the order was never actually cancelled;
        // only record the failed attempt.
        await tx
          .update(logisticsOrder)
          .set({ cancellationStatus: "failed", updatedAt: new Date() })
          .where(eq(logisticsOrder.orderId, resolvedOrderId));
        return;
      }

      if (!confirmed) {
        // No error, but the payload didn't actually confirm cancellation —
        // never guess; leave state/cancellationStatus untouched.
        console.log(
          "[cancel.repository] /on_cancel had no error but did not confirm cancellation",
          { transactionId: c.transaction_id, orderId: resolvedOrderId, receivedState: order?.state },
        );
        return;
      }

      columns = order ? buildLogisticsOrderColumns(order) : undefined;
      await tx
        .update(logisticsOrder)
        .set({
          bppId: c.bpp_id,
          bppUri: c.bpp_uri,
          ...columns,
          cancellationStatus: "succeeded",
          cancellationReasonId: order?.cancellation?.reason?.id,
          cancelledBy: order?.cancellation?.cancelled_by,
          updatedAt: new Date(),
        })
        .where(eq(logisticsOrder.orderId, resolvedOrderId));
      if (order) await syncLogisticsOrderTags(tx, resolvedOrderId, order);
    });

    if (confirmed) {
      const cancellationReasonId = order?.cancellation?.reason?.id;
      const cancellationReasonText = getCancellationReasonText(cancellationReasonId);
      orderSseManager.publish(resolvedOrderId, {
        event: "order_status",
        orderId: resolvedOrderId,
        state: columns?.state,
        fulfillmentState: columns?.fulfillmentStateCode,
        awbNo: columns?.awbNo,
        cancellationReasonId,
        cancellationReasonText,
        cancelledBy: order?.cancellation?.cancelled_by,
        updatedAt: new Date().toISOString(),
      });
      clientStreamManager.push(c.transaction_id, "order_cancelled", {
        orderId: resolvedOrderId,
        state: columns?.state,
        fulfillmentState: columns?.fulfillmentStateCode,
        awbNo: columns?.awbNo,
        cancellationReasonId,
        cancellationReasonText,
        cancelledBy: order?.cancellation?.cancelled_by,
        updatedAt: new Date().toISOString(),
      });
    } else if (response.error) {
      clientStreamManager.push(c.transaction_id, "cancel_error", {
        orderId: resolvedOrderId,
        code: response.error.code,
        message: response.error.message,
      });
    }

    console.log("[cancel.repository] /on_cancel persisted", {
      transactionId: c.transaction_id,
      orderId: resolvedOrderId,
      confirmed,
    });
    return "processed" as const;
  }
}
