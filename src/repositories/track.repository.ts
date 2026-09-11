import { and, eq } from "drizzle-orm";
import { db1 } from "../db/index.js";
import { logisticsOrder, ondcTransactions } from "../db/schema/index.js";
import { orderSseManager } from "../utils/order-sse.js";
import {
  buildTrackingColumns,
  loadLogisticsOrder,
  type LogisticsOrderRow,
} from "./logistics-order-shared.js";
import type { OndcOnTrackResponse, OndcTrackRequest } from "../types/track/ondc.js";

export type TrackCallbackResult =
  "processed" | "duplicate" | "not_found" | "invalid_fulfillment";

export interface TrackRepository {
  loadOrder(orderId: string): Promise<LogisticsOrderRow | undefined>;
  create(payload: OndcTrackRequest): Promise<boolean>;
  updateStatus(
    transactionId: string,
    messageId: string,
    status: string,
    error?: { code?: string; message?: string },
  ): Promise<void>;
  handleCallback(response: OndcOnTrackResponse): Promise<TrackCallbackResult>;
}

export class DrizzleTrackRepository implements TrackRepository {
  constructor(private readonly database: typeof db1 = db1) {}

  async loadOrder(orderId: string) {
    return loadLogisticsOrder(this.database, orderId);
  }

  async create(payload: OndcTrackRequest) {
    const existing = await this.database
      .select({ id: ondcTransactions.id })
      .from(ondcTransactions)
      .where(
        and(
          eq(ondcTransactions.transactionId, payload.context.transaction_id),
          eq(ondcTransactions.messageId, payload.context.message_id),
          eq(ondcTransactions.action, "track"),
          eq(ondcTransactions.orderId, payload.message.order_id),
        ),
      )
      .limit(1);
    if (existing.length > 0) return false;

    console.log("[track.repository] persisting /track", {
      orderId: payload.message.order_id,
      transactionId: payload.context.transaction_id,
      messageId: payload.context.message_id,
    });
    await this.database.insert(ondcTransactions).values({
      transactionId: payload.context.transaction_id,
      messageId: payload.context.message_id,
      action: "track",
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
          eq(ondcTransactions.action, "track"),
        ),
      );
  }

  async handleCallback(response: OndcOnTrackResponse) {
    const c = response.context;
    console.log("[track.repository] looking up /on_track", {
      transactionId: c.transaction_id,
      messageId: c.message_id,
      bppId: c.bpp_id,
      hasError: Boolean(response.error),
    });
    // Per contract, /on_track is always a SOLICITED response (unlike
    // /on_status) reusing the /track request's message_id as-is (same
    // pattern as /on_update) — matched directly by
    // (transaction_id, action, message_id).
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
          eq(ondcTransactions.action, "track"),
          eq(ondcTransactions.messageId, c.message_id),
        ),
      )
      .limit(1);
    if (!row || !row.orderId) {
      console.log("[track.repository] track transaction not found", {
        transactionId: c.transaction_id,
        messageId: c.message_id,
      });
      return "not_found";
    }
    if (row.callbackTimestamp) {
      console.log("[track.repository] duplicate /on_track callback", {
        transactionId: c.transaction_id,
        messageId: c.message_id,
      });
      return "duplicate";
    }

    const orderRow = await loadLogisticsOrder(this.database, row.orderId);
    const tracking = response.message?.tracking;
    if (
      !response.error &&
      tracking?.id &&
      orderRow?.fulfillmentId &&
      tracking.id !== orderRow.fulfillmentId
    ) {
      console.log("[track.repository] /on_track fulfillment.id mismatch", {
        transactionId: c.transaction_id,
        expectedFulfillmentId: orderRow.fulfillmentId,
        receivedFulfillmentId: tracking.id,
      });
      return "invalid_fulfillment";
    }

    let columns: ReturnType<typeof buildTrackingColumns> | undefined;

    await this.database.transaction(async (tx) => {
      if (!response.error && tracking) {
        columns = buildTrackingColumns(tracking);
        await tx
          .update(logisticsOrder)
          .set({ ...columns, updatedAt: new Date() })
          .where(eq(logisticsOrder.orderId, row.orderId as string));
      }
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
        .where(eq(ondcTransactions.id, row.id));
    });

    if (!response.error && columns) {
      // tracking.tags is [{code:"path", list:[{code:"lat_lng",...},{code:"sequence",...}]}, ...]
      // — one tag group per breadcrumb point — so each group's list is
      // paired into a single {lat_lng, sequence} entry.
      const path = (tracking?.tags ?? [])
        .filter((t) => t.code === "path")
        .map((t) => {
          const list = t.list ?? [];
          return {
            lat_lng: list.find((v) => v.code === "lat_lng")?.value,
            sequence: list.find((v) => v.code === "sequence")?.value,
          };
        });
      orderSseManager.publish(row.orderId, {
        event: "order_tracking",
        orderId: row.orderId,
        url: columns.trackingUrl,
        status: columns.trackingStatus,
        gps: columns.trackingGps,
        locationTimestamp: tracking?.location?.time?.timestamp,
        path,
        updatedAt: new Date().toISOString(),
      });
    }

    console.log("[track.repository] /on_track persisted", {
      transactionId: c.transaction_id,
      orderId: row.orderId,
      status: columns?.trackingStatus,
    });
    return "processed";
  }
}
