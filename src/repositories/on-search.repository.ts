import { and, eq } from "drizzle-orm";
import { db1 } from "../db/index.js";
import {
  logisticsSearches,
  onSearchCallbacks,
  ondcTransactions,
  providerLocations,
  searchProviderCategories,
  searchProviderFulfillments,
  searchProviderItems,
  searchProviders,
  tagValues,
  tags,
} from "../db/schema/index.js";
import type {
  OndcFulfillment,
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

const distanceTag = (fulfillment: OndcFulfillment) => {
  const distance = fulfillment.tags?.find((tag) => tag.code === "distance");
  return {
    unit: distance?.list?.find((item) => item.code === "motorable_distance_type")
      ?.value,
    value: distance?.list?.find((item) => item.code === "motorable_distance")
      ?.value,
  };
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
  fulfillments: (p.fulfillments ?? []).map((x) => {
    const distance = distanceTag(x);
    return {
      fulfillmentId: x.id,
      type: x.type,
      pickupDuration: x.start?.time?.duration,
      motorableDistance: distance.value,
      motorableDistanceUnit: distance.unit,
    };
  }),
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
    parentItemId: x.parent_item_id || undefined,
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
        searchId: search.id,
        transactionId: c.transaction_id,
        messageId: c.message_id,
        bppId,
        bppUri: c.bpp_uri,
      })
      .returning({ id: onSearchCallbacks.id });

    await this.database
      .update(ondcTransactions)
      .set({
        bppId,
        bppUri: c.bpp_uri,
        callbackMessageId: c.message_id,
        callbackTimestamp: parseDate(c.timestamp),
        status: "received",
        updatedAt: new Date(),
      })
      .where(eq(ondcTransactions.id, txn.id));

    return { callbackId: row.id, duplicate: false, searchId: search.id };
  }

  async process(callbackId: string, response: OndcOnSearchResponse) {
    const [staged] = await this.database
      .select({
        searchId: onSearchCallbacks.searchId,
        transactionId: onSearchCallbacks.transactionId,
      })
      .from(onSearchCallbacks)
      .where(eq(onSearchCallbacks.id, callbackId))
      .limit(1);

    if (!staged) throw new Error("on_search staging record not found");

    const [search] = await this.database
      .select({ id: logisticsSearches.id, transactionDbId: logisticsSearches.transactionDbId })
      .from(logisticsSearches)
      .where(eq(logisticsSearches.id, staged.searchId))
      .limit(1);
    if (!search) throw new Error("logistics search not found");

    console.log("[on-search.repository] starting catalog ingestion", {
      callbackId,
    });

    const providers =
      response.message.catalog["bpp/providers"].map(normalizeProvider);

    await this.database.transaction(async (tx) => {
      for (const provider of response.message.catalog["bpp/providers"])
        await this.insertProvider(tx, callbackId, provider);
      await tx
        .update(onSearchCallbacks)
        .set({ status: "processed", processedAt: new Date() })
        .where(eq(onSearchCallbacks.id, callbackId));
      await tx
        .update(ondcTransactions)
        .set({ status: "completed", updatedAt: new Date() })
        .where(eq(ondcTransactions.id, search.transactionDbId));
    });

    console.log("[on-search.repository] catalog ingestion committed", {
      searchId: search.id,
      providerCount: providers.length,
    });
    return { searchId: search.id, providers };
  }

  private async insertProvider(tx: any, callbackId: string, p: OndcProvider) {
    const [providerRow] = await tx
      .insert(searchProviders)
      .values({
        callbackId,
        providerId: p.id,
        name: p.descriptor?.name,
        shortDescription: p.descriptor?.short_desc,
        longDescription: p.descriptor?.long_desc,
      })
      .returning({ id: searchProviders.id });
    const providerRowId = providerRow.id;

    if (p.categories?.length)
      await tx.insert(searchProviderCategories).values(
        p.categories.map((x) => ({
          providerRowId,
          categoryId: x.id,
          timeLabel: x.time?.label,
          duration: x.time?.duration,
          timestamp: parseDate(x.time?.timestamp),
        })),
      );

    const fulfillmentRowIdByExternalId = new Map<string, string>();
    for (const f of p.fulfillments ?? []) {
      const distance = distanceTag(f);
      const [fRow] = await tx
        .insert(searchProviderFulfillments)
        .values({
          providerRowId,
          fulfillmentId: f.id,
          type: f.type,
          pickupDuration: f.start?.time?.duration,
          motorableDistance: distance.value,
          motorableDistanceUnit: distance.unit,
        })
        .returning({ id: searchProviderFulfillments.id });
      fulfillmentRowIdByExternalId.set(f.id, fRow.id);

      for (const tag of f.tags ?? []) {
        const [tagRow] = await tx
          .insert(tags)
          .values({ searchProviderFulfillmentId: fRow.id, code: tag.code })
          .returning({ id: tags.id });
        if (tag.list?.length)
          await tx.insert(tagValues).values(
            tag.list.map((v) => ({
              tagId: tagRow.id,
              code: v.code,
              value: v.value,
            })),
          );
      }
    }

    if (p.locations?.length)
      await tx.insert(providerLocations).values(
        p.locations.map((x, position) => ({
          searchProviderRowId: providerRowId,
          position,
          locationId: x.id,
          gps: x.gps,
          addressName: x.address?.name,
          addressBuilding: x.address?.building,
          addressLocality: x.address?.locality,
          street: x.address?.street,
          city: x.address?.city,
          state: x.address?.state,
          country: x.address?.country,
          areaCode: x.address?.area_code,
        })),
      );

    if (p.items?.length)
      await tx.insert(searchProviderItems).values(
        p.items.map((x) => ({
          providerRowId,
          fulfillmentRowId: x.fulfillment_id
            ? fulfillmentRowIdByExternalId.get(x.fulfillment_id)
            : undefined,
          catalogItemId: x.id,
          parentItemId: x.parent_item_id || undefined,
          categoryId: x.category_id,
          fulfillmentId: x.fulfillment_id,
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
