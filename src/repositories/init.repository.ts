import { and, eq } from "drizzle-orm";
import { db1 } from "../db/index.js";
import { logisticsSearches, onSearchCallbacks, ondcTransactions } from "../db/schema/index.js";
import type { InitRequest } from "../types/init/internal.js";
import type { OndcInitRequest, OndcOnInitResponse } from "../types/init/ondc.js";
import type { OndcOnSearchResponse, OndcSearchRequest } from "../types/search/ondc.js";
import { mapInitRequestToOndc } from "../mappers/init.mapper.js";

export interface InitRepository {
  prepare(input: InitRequest, ids: { transactionId: string; messageId: string; timestamp: string }, protocol: any): Promise<{ payload: OndcInitRequest; parentTransactionId: string }>;
  create(payload: OndcInitRequest, parentTransactionId: string): Promise<{ initId: string }>;
  updateStatus(transactionId: string, status: string, error?: { code?: string; message?: string }): Promise<void>;
  handleCallback(response: OndcOnInitResponse): Promise<"processed" | "duplicate" | "not_found">;
}

export class DrizzleInitRepository implements InitRepository {
  constructor(private readonly database: typeof db1 = db1) {}

  async prepare(input: InitRequest, ids: { transactionId: string; messageId: string; timestamp: string }, protocol: any) {
    const [search] = await this.database.select({ transactionDbId: logisticsSearches.transactionDbId }).from(logisticsSearches).where(eq(logisticsSearches.id, input.searchId)).limit(1);
    if (!search) throw new Error("search not found");
    const [parent] = await this.database.select({ id: ondcTransactions.id, transactionId: ondcTransactions.transactionId, requestPayload: ondcTransactions.requestPayload }).from(ondcTransactions).where(eq(ondcTransactions.id, search.transactionDbId)).limit(1);
    if (!parent) throw new Error("search transaction not found");
    const [callback] = await this.database.select({ payload: onSearchCallbacks.payload, bppUri: onSearchCallbacks.bppUri }).from(onSearchCallbacks).where(and(eq(onSearchCallbacks.transactionId, parent.transactionId), eq(onSearchCallbacks.bppId, input.bppId))).orderBy(onSearchCallbacks.receivedAt).limit(1);
    if (!callback) throw new Error("selected BPP has no search result");
    const searchPayload = parent.requestPayload as OndcSearchRequest;
    const callbackPayload = callback.payload as OndcOnSearchResponse;
    const provider = callbackPayload.message.catalog["bpp/providers"].find((p) => p.id === input.providerId);
    if (!provider) throw new Error("provider not found in search result");
    const item = (provider.items ?? []).find((x) => x.id === input.itemId);
    if (!item) throw new Error("item not found in search result");
    const fulfillment = (provider.fulfillments ?? []).find((x) => x.id === input.fulfillmentId);
    if (!fulfillment) throw new Error("fulfillment not found in search result");
    const enriched = { ...callbackPayload, context: { ...callbackPayload.context, bpp_uri: callback.bppUri ?? callbackPayload.context.bpp_uri } };
    return { payload: mapInitRequestToOndc(input, searchPayload, enriched, ids, protocol), parentTransactionId: parent.transactionId };
  }

  async create(payload: OndcInitRequest, parentTransactionId: string) {
    const [row] = await this.database.insert(ondcTransactions).values({ transactionId: payload.context.transaction_id, messageId: payload.context.message_id, action: "init", parentTransactionId, status: "pending", domain: payload.context.domain, country: payload.context.country, city: payload.context.city, coreVersion: payload.context.core_version, bapId: payload.context.bap_id, bapUri: payload.context.bap_uri, bppId: payload.context.bpp_id, bppUri: payload.context.bpp_uri, timestamp: new Date(payload.context.timestamp), ttl: payload.context.ttl, requestPayload: payload }).returning({ id: ondcTransactions.id });
    return { initId: row.id };
  }

  async updateStatus(transactionId: string, status: string, error?: { code?: string; message?: string }) { await this.database.update(ondcTransactions).set({ status, errorCode: error?.code, errorMessage: error?.message, updatedAt: new Date() }).where(and(eq(ondcTransactions.transactionId, transactionId), eq(ondcTransactions.action, "init"))); }

  async handleCallback(response: OndcOnInitResponse) {
    const c = response.context;
    const [row] = await this.database.select({ id: ondcTransactions.id, callbackMessageId: ondcTransactions.callbackMessageId }).from(ondcTransactions).where(and(eq(ondcTransactions.transactionId, c.transaction_id), eq(ondcTransactions.action, "init"))).limit(1);
    if (!row) return "not_found" as const;
    if (row.callbackMessageId === c.message_id) return "duplicate" as const;
    await this.database.update(ondcTransactions).set({ status: response.error ? "failed" : "completed", responsePayload: response, callbackMessageId: c.message_id, callbackTimestamp: c.timestamp ? new Date(c.timestamp) : undefined, bppId: c.bpp_id, bppUri: c.bpp_uri, errorCode: response.error?.code as string | undefined, errorMessage: response.error?.message as string | undefined, updatedAt: new Date() }).where(eq(ondcTransactions.id, row.id));
    return "processed" as const;
  }
}
