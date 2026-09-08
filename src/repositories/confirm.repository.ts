import { and, eq } from "drizzle-orm";
import { db1 } from "../db/index.js";
import { ondcTransactions } from "../db/schema/index.js";
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

    console.log("[confirm.repository] initialized state loaded", {
      initTransactionId,
      status: row.status,
    });
    return {
      init,
      onInit,
      initTransactionId: row.transactionId,
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
    await this.database.insert(ondcTransactions).values({
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
    console.log("[confirm.repository] looking up /on_confirm", {
      transactionId: c.transaction_id,
      messageId: c.message_id,
      bppId: c.bpp_id,
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
        ),
      )
      .limit(1);
    if (!row) {
      console.log("[confirm.repository] confirm transaction not found", {
        transactionId: c.transaction_id,
      });
      return "not_found";
    }
    if (row.callbackMessageId === c.message_id) return "duplicate";
    if (row.bppId && c.bpp_id && row.bppId !== c.bpp_id) return "invalid_bpp";
    if (
      !response.error &&
      row.orderId &&
      response.message?.order?.id !== row.orderId
    )
      return "invalid_order";
    const state = response.error
      ? "failed"
      : (response.message?.order?.state ?? "unknown");
    await this.database
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
    console.log("[confirm.repository] /on_confirm persisted", {
      transactionId: c.transaction_id,
      orderId: row.orderId,
      state,
    });
    return "processed";
  }
}
