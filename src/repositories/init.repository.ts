import { and, eq } from "drizzle-orm";
import { db1 } from "../db/index.js";
import {
  logisticsSearches,
  onSearchCallbacks,
  ondcTransactions,
} from "../db/schema/index.js";
import type {
  InitRequest,
  ResolvedInitSelection,
} from "../types/init/internal.js";
import type {
  OndcInitRequest,
  OndcOnInitResponse,
} from "../types/init/ondc.js";
import type { OndcOnSearchResponse } from "../types/search/ondc.js";

export interface InitRepository {
  resolveSelection(
    request: InitRequest,
  ): Promise<
    | { status: "ok"; selection: ResolvedInitSelection }
    | { status: "not_found" | "not_ready" | "ambiguous" }
  >;
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

  async resolveSelection(request: InitRequest) {
    const [search] = await this.database
      .select({
        transactionId: ondcTransactions.transactionId,
        requestPayload: ondcTransactions.requestPayload,
      })
      .from(logisticsSearches)
      .innerJoin(
        ondcTransactions,
        eq(logisticsSearches.transactionDbId, ondcTransactions.id),
      )
      .where(eq(logisticsSearches.id, request.searchId))
      .limit(1);
    if (!search) return { status: "not_found" as const };
    const callbacks = await this.database
      .select({
        payload: onSearchCallbacks.payload,
        status: onSearchCallbacks.status,
      })
      .from(onSearchCallbacks)
      .where(eq(onSearchCallbacks.transactionId, search.transactionId));
    const processed = callbacks.filter((x) => x.status === "processed");
    if (!processed.length) return { status: "not_ready" as const };
    const candidates: ResolvedInitSelection[] = [];
    for (const row of processed) {
      const callback = row.payload as OndcOnSearchResponse;
      for (const provider of callback.message.catalog["bpp/providers"] ?? []) {
        for (const item of provider.items ?? []) {
          for (const fulfillment of provider.fulfillments ?? []) {
            if (item.fulfillment_id && item.fulfillment_id !== fulfillment.id)
              continue;
            if (request.bppId && callback.context.bpp_id !== request.bppId)
              continue;
            if (request.providerId && provider.id !== request.providerId)
              continue;
            if (request.itemId && item.id !== request.itemId) continue;
            if (
              request.fulfillmentId &&
              fulfillment.id !== request.fulfillmentId
            )
              continue;
            candidates.push({
              searchTransactionId: search.transactionId,
              bppId: callback.context.bpp_id ?? "",
              bppUri: callback.context.bpp_uri ?? "",
              provider,
              item,
              fulfillment,
              search: search.requestPayload as unknown as any,
              providerLocations: provider.locations ?? [],
            });
          }
        }
      }
    }
    const unique = candidates.filter(
      (candidate, index, all) =>
        all.findIndex(
          (x) =>
            x.bppId === candidate.bppId &&
            x.provider.id === candidate.provider.id &&
            x.item.id === candidate.item.id &&
            x.fulfillment.id === candidate.fulfillment.id,
        ) === index,
    );
    if (!unique.length) return { status: "not_found" as const };
    if (unique.length !== 1) return { status: "ambiguous" as const };
    return { status: "ok" as const, selection: unique[0] };
  }

  async create(payload: OndcInitRequest) {
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
    if (!row) return "not_found" as const;
    if (row.callbackMessageId === c.message_id) return "duplicate" as const;
    await this.database
      .update(ondcTransactions)
      .set({
        status: response.error ? "failed" : "completed",
        responsePayload: response,
        callbackMessageId: c.message_id,
        callbackTimestamp: new Date(c.timestamp),
        bppId: c.bpp_id,
        bppUri: c.bpp_uri,
        errorCode: response.error?.code as string | undefined,
        errorMessage: response.error?.message as string | undefined,
        updatedAt: new Date(),
      })
      .where(eq(ondcTransactions.id, row.id));
    return "processed" as const;
  }
}
