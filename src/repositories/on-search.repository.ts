import { and, eq } from "drizzle-orm";
import { db1 } from "../db/index.js";
import {
  logisticsSearches,
  lspCatalogItems,
  lspProviderCategories,
  lspProviderFulfillments,
  lspProviderLocations,
  lspProviders,
  onSearchCallbacks,
  ondcTransactions,
} from "../db/schema/index.js";
import type {
  OndcOnSearchResponse,
  OndcProvider,
} from "../types/search/ondc.js";
import type { NormalizedProviderResult } from "../types/search/internal.js";

export interface OnSearchRepository {
  stage(
    response: OndcOnSearchResponse,
  ): Promise<{ callbackId: string; duplicate: boolean; searchId?: string }>;
  process(
    callbackId: string,
    response: OndcOnSearchResponse,
  ): Promise<{ searchId: string; providers: NormalizedProviderResult[] }>;
}

const parseDate = (value?: string) => {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
};
const normalizeProvider = (p: OndcProvider): NormalizedProviderResult => ({
  providerId: p.id,
  name: p.descriptor?.name,
  shortDescription: p.descriptor?.short_desc,
  longDescription: p.descriptor?.long_desc,
  categories: (p.categories ?? []).map((x) => ({
    categoryId: x.id,
    timeLabel: x.time?.label,
    duration: x.time?.duration,
    timestamp: x.time?.timestamp,
  })),
  fulfillments: (p.fulfillments ?? []).map((x) => ({
    fulfillmentId: x.id,
    type: x.type,
  })),
  locations: (p.locations ?? []).map((x) => ({
    locationId: x.id,
    gps: x.gps,
    street: x.address?.street,
    city: x.address?.city,
    state: x.address?.state,
    areaCode: x.address?.area_code,
  })),
  items: (p.items ?? []).map((x) => ({
    catalogItemId: x.id,
    parentItemId: x.parent_item_id,
    categoryId: x.category_id,
    fulfillmentId: x.fulfillment_id,
    descriptorCode: x.descriptor?.code,
    name: x.descriptor?.name,
    shortDescription: x.descriptor?.short_desc,
    longDescription: x.descriptor?.long_desc,
    tatLabel: x.time?.label,
    tatDuration: x.time?.duration,
    tatTimestamp: x.time?.timestamp,
    priceAmount: x.price?.value,
    priceCurrency: x.price?.currency,
  })),
});

export class DrizzleOnSearchRepository implements OnSearchRepository {
  constructor(private readonly database: typeof db1 = db1) {}

  async stage(response: OndcOnSearchResponse) {
    const c = response.context,
      bppId = c.bpp_id ?? "unknown";
    const [txn] = await this.database
      .select({ id: ondcTransactions.id })
      .from(ondcTransactions)
      .where(
        and(
          eq(ondcTransactions.transactionId, c.transaction_id),
          eq(ondcTransactions.action, "search"),
        ),
      )
      .limit(1);

    console.log("[on-search.repository] transaction lookup complete", {
      transactionId: c.transaction_id,
      found: Boolean(txn),
    });

    if (!txn) return { callbackId: "", duplicate: false };

    const [old] = await this.database
      .select({ id: onSearchCallbacks.id })
      .from(onSearchCallbacks)
      .where(
        and(
          eq(onSearchCallbacks.transactionId, c.transaction_id),
          eq(onSearchCallbacks.messageId, c.message_id),
          eq(onSearchCallbacks.bppId, bppId),
        ),
      )
      .limit(1);

    const [search] = await this.database
      .select({ id: logisticsSearches.id })
      .from(logisticsSearches)
      .where(eq(logisticsSearches.transactionDbId, txn.id))
      .limit(1);
    if (!search) return { callbackId: "", duplicate: false };

    if (old)
      return { callbackId: old.id, duplicate: true, searchId: search.id };

    const [row] = await this.database
      .insert(onSearchCallbacks)
      .values({
        transactionId: c.transaction_id,
        messageId: c.message_id,
        bppId,
        bppUri: c.bpp_uri,
        payload: response,
      })
      .returning({ id: onSearchCallbacks.id });

    await this.database
      .update(ondcTransactions)
      .set({
        bppId,
        bppUri: c.bpp_uri,
        responsePayload: response,
        callbackMessageId: c.message_id,
        callbackTimestamp: parseDate(c.timestamp),
        status: "received",
        updatedAt: new Date(),
      })
      .where(eq(ondcTransactions.id, txn.id));

    return { callbackId: row.id, duplicate: false, searchId: search.id };
  }

  async process(callbackId: string, response: OndcOnSearchResponse) {
    const c = response.context;
    const [staged] = await this.database
      .select({ transactionId: onSearchCallbacks.transactionId })
      .from(onSearchCallbacks)
      .where(eq(onSearchCallbacks.id, callbackId))
      .limit(1);

    if (!staged) throw new Error("on_search staging record not found");

    const [txn] = await this.database
      .select({ id: ondcTransactions.id })
      .from(ondcTransactions)
      .where(
        and(
          eq(ondcTransactions.transactionId, staged.transactionId),
          eq(ondcTransactions.action, "search"),
        ),
      )
      .limit(1);
    console.log("[on-search.repository] transaction lookup complete", {
      transactionId: c.transaction_id,
      found: Boolean(txn),
    });

    if (!txn) throw new Error("search transaction not found");
    const [search] = await this.database
      .select({ id: logisticsSearches.id })
      .from(logisticsSearches)
      .where(eq(logisticsSearches.transactionDbId, txn.id))
      .limit(1);
    if (!search) throw new Error("logistics search not found");
    console.log("[on-search.repository] starting catalog ingestion", {
      callbackId,
    });

    const providers =
      response.message.catalog["bpp/providers"].map(normalizeProvider);
    await this.database.transaction(async (tx) => {
      for (const provider of response.message.catalog["bpp/providers"])
        await this.upsertProvider(tx, search.id, provider);
      await tx
        .update(onSearchCallbacks)
        .set({ status: "processed", processedAt: new Date() })
        .where(eq(onSearchCallbacks.id, callbackId));
      await tx
        .update(ondcTransactions)
        .set({ status: "completed", updatedAt: new Date() })
        .where(eq(ondcTransactions.id, txn.id));
    });

    console.log("[on-search.repository] catalog ingestion committed", {
      searchId: search.id,
      providerCount: providers.length,
    });
    return { searchId: search.id, providers };
  }

  private async upsertProvider(tx: any, searchId: string, p: OndcProvider) {
    const [old] = await tx
      .select({ id: lspProviders.id })
      .from(lspProviders)
      .where(
        and(
          eq(lspProviders.searchId, searchId),
          eq(lspProviders.providerId, p.id),
        ),
      )
      .limit(1);
    const values = {
      searchId,
      providerId: p.id,
      name: p.descriptor?.name,
      shortDescription: p.descriptor?.short_desc,
      longDescription: p.descriptor?.long_desc,
      updatedAt: new Date(),
    };
    const providerId = old
      ? (
          await tx
            .update(lspProviders)
            .set(values)
            .where(eq(lspProviders.id, old.id))
            .returning({ id: lspProviders.id })
        )[0].id
      : (
          await tx
            .insert(lspProviders)
            .values(values)
            .returning({ id: lspProviders.id })
        )[0].id;

    await tx
      .delete(lspProviderCategories)
      .where(eq(lspProviderCategories.providerDbId, providerId));
    await tx
      .delete(lspProviderFulfillments)
      .where(eq(lspProviderFulfillments.providerDbId, providerId));
    await tx
      .delete(lspProviderLocations)
      .where(eq(lspProviderLocations.providerDbId, providerId));
    await tx
      .delete(lspCatalogItems)
      .where(eq(lspCatalogItems.providerDbId, providerId));

    if (p.categories?.length)
      await tx.insert(lspProviderCategories).values(
        p.categories.map((x) => ({
          providerDbId: providerId,
          categoryId: x.id,
          timeLabel: x.time?.label,
          duration: x.time?.duration,
          timestamp: parseDate(x.time?.timestamp),
        })),
      );
    if (p.fulfillments?.length)
      await tx.insert(lspProviderFulfillments).values(
        p.fulfillments.map((x) => ({
          providerDbId: providerId,
          fulfillmentId: x.id,
          type: x.type,
        })),
      );
    if (p.locations?.length)
      await tx.insert(lspProviderLocations).values(
        p.locations.map((x) => ({
          providerDbId: providerId,
          locationId: x.id,
          gps: x.gps,
          street: x.address?.street,
          city: x.address?.city,
          state: x.address?.state,
          areaCode: x.address?.area_code,
        })),
      );
    if (p.items?.length)
      await tx.insert(lspCatalogItems).values(
        p.items.map((x) => ({
          providerDbId: providerId,
          catalogItemId: x.id,
          categoryId: x.category_id,
          descriptorCode: x.descriptor?.code,
          name: x.descriptor?.name,
          shortDescription: x.descriptor?.short_desc,
          longDescription: x.descriptor?.long_desc,
          tatLabel: x.time?.label,
          tatDuration: x.time?.duration,
          tatTimestamp: parseDate(x.time?.timestamp),
          priceAmount: x.price?.value,
          priceCurrency: x.price?.currency,
        })),
      );
  }
}
