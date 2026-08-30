import { and, eq } from "drizzle-orm";
import { db1 } from "../db/index.js";
import { ondcTransactions } from "../db/schema/index.js";
import type {
  OndcInitRequest,
  OndcOnInitResponse,
} from "../types/init/ondc.js";
export interface InitRepository {
  create(payload: OndcInitRequest): Promise<{ initId: string }>;
  updateStatus(
    transactionId: string,
    status: string,
    error?: { code?: string; message?: string },
  ): Promise<void>;
  handleCallback(
    response: OndcOnInitResponse,
  ): Promise<"processed" | "duplicate" | "not_found">;
}
export class DrizzleInitRepository implements InitRepository {
  constructor(private readonly database: typeof db1 = db1) {}
  async create(payload: OndcInitRequest) {
    console.log("[init.repository] persisting /init", {
      transactionId: payload.context.transaction_id,
      messageId: payload.context.message_id,
      bppId: payload.context.bpp_id,
    });
    const [row] = await this.database
      .insert(ondcTransactions)
      .values({
        transactionId: payload.context.transaction_id,
        messageId: payload.context.message_id,
        action: "init",
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
        requestPayload: payload,
      })
      .returning({ id: ondcTransactions.id });
    return { initId: row.id };
  }
  async updateStatus(
    transactionId: string,
    status: string,
    error?: { code?: string; message?: string },
  ) {
    console.log("[init.repository] updating status", {
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
          eq(ondcTransactions.action, "init"),
        ),
      );
  }
  async handleCallback(response: OndcOnInitResponse) {
    const c = response.context;
    console.log("[init.repository] looking up /on_init", {
      transactionId: c.transaction_id,
      messageId: c.message_id,
      bppId: c.bpp_id,
    });
    const [row] = await this.database
      .select({
        id: ondcTransactions.id,
        callbackMessageId: ondcTransactions.callbackMessageId,
      })
      .from(ondcTransactions)
      .where(
        and(
          eq(ondcTransactions.transactionId, c.transaction_id),
          eq(ondcTransactions.action, "init"),
        ),
      )
      .limit(1);
    if (!row) {
      console.log("[init.repository] init transaction not found", {
        transactionId: c.transaction_id,
      });
      return "not_found" as const;
    }
    if (row.callbackMessageId === c.message_id) {
      console.log("[init.repository] duplicate /on_init ignored", {
        transactionId: c.transaction_id,
        messageId: c.message_id,
      });
      return "duplicate" as const;
    }
    const error = response.error;
    await this.database
      .update(ondcTransactions)
      .set({
        status: error ? "failed" : "completed",
        responsePayload: response,
        callbackMessageId: c.message_id,
        callbackTimestamp: new Date(c.timestamp),
        bppId: c.bpp_id,
        bppUri: c.bpp_uri,
        errorCode: error?.code as string | undefined,
        errorMessage: error?.message as string | undefined,
        updatedAt: new Date(),
      })
      .where(eq(ondcTransactions.id, row.id));
    console.log("[init.repository] /on_init persisted", {
      transactionId: c.transaction_id,
      status: error ? "failed" : "completed",
    });
    return "processed" as const;
  }
}
