import { and, eq } from "drizzle-orm";
import { db1 } from "../db/index.js";
import {
  logisticsSearches,
  ondcTransactions,
  onSearchCallbacks,
  providerLocations,
  searchProviderFulfillments,
  searchProviderItems,
  searchProviders,
  tagValues,
  tags,
} from "../db/schema/index.js";
import type { SearchRequest } from "../types/search/internal.js";
import type { OndcSearchRequest } from "../types/search/ondc.js";

export type SearchRepository = {
  createSearch(input: {
    request: SearchRequest;
    payload: OndcSearchRequest;
  }): Promise<{ searchId: string }>;
  getSearchOptions(
    searchId: string,
  ): Promise<{ status: "NOT_FOUND" | "PENDING" | "READY"; options: unknown[] }>;
  updateTransactionStatus(
    transactionId: string,
    status: string,
    error?: { code?: string; message?: string },
  ): Promise<void>;
};

const numeric = (value: string | number) => String(value);

export class DrizzleSearchRepository implements SearchRepository {
  constructor(private readonly database: typeof db1 = db1) {}

  async createSearch({
    request,
    payload,
  }: Parameters<SearchRepository["createSearch"]>[0]) {
    return this.database.transaction(async (tx) => {
      const [transaction] = await tx
        .insert(ondcTransactions)
        .values({
          transactionId: payload.context.transaction_id,
          messageId: payload.context.message_id,
          action: "search",
          status: "pending",
          domain: payload.context.domain,
          country: payload.context.country,
          city: payload.context.city,
          coreVersion: payload.context.core_version,
          bapId: payload.context.bap_id,
          bapUri: payload.context.bap_uri,
          timestamp: new Date(payload.context.timestamp),
          ttl: payload.context.ttl,
        })
        .returning({ id: ondcTransactions.id });

      const [search] = await tx
        .insert(logisticsSearches)
        .values({
          transactionDbId: transaction.id,
          categoryId: request.categoryId,
          fulfillmentType: request.fulfillmentType,
          authorizationStartType: request.authorization.startType,
          authorizationEndType: request.authorization.endType,

          startGps: request.start.gps,
          startAddressName: request.start.address.name,
          startAddressBuilding: request.start.address.building,
          startAddressLocality: request.start.address.locality,
          startAddressStreet: request.start.address.street,
          startAddressCity: request.start.address.city,
          startAddressState: request.start.address.state,
          startAddressCountry: request.start.address.country,
          startAreaCode: request.start.address.areaCode,

          endGps: request.end.gps,
          endAddressName: request.end.address.name,
          endAddressBuilding: request.end.address.building,
          endAddressLocality: request.end.address.locality,
          endAddressStreet: request.end.address.street,
          endAddressCity: request.end.address.city,
          endAddressState: request.end.address.state,
          endAddressCountry: request.end.address.country,
          endAreaCode: request.end.address.areaCode,

          ...(request.schedule
            ? {
                scheduleDays: request.schedule.days,
                scheduleDuration: request.schedule.duration,
                scheduleRangeStart: request.schedule.rangeStart,
                scheduleRangeEnd: request.schedule.rangeEnd,
                scheduleHolidays: request.schedule.holidays?.length
                  ? request.schedule.holidays
                  : undefined,
              }
            : {}),

          ...(request.payload
            ? {
                payloadWeightValue: numeric(request.payload.weight.value),
                payloadWeightUnit: request.payload.weight.unit,
                payloadLengthValue: numeric(
                  request.payload.dimensions.length.value,
                ),
                payloadLengthUnit: request.payload.dimensions.length.unit,
                payloadBreadthValue: numeric(
                  request.payload.dimensions.breadth.value,
                ),
                payloadBreadthUnit: request.payload.dimensions.breadth.unit,
                payloadHeightValue: numeric(
                  request.payload.dimensions.height.value,
                ),
                payloadHeightUnit: request.payload.dimensions.height.unit,
                payloadCategory: request.payload.category,
                payloadValueAmount: numeric(request.payload.value.amount),
                payloadValueCurrency: request.payload.value.currency,
                payloadDangerousGoods: request.payload.dangerousGoods,
              }
            : {}),

          ...(request.payment
            ? {
                paymentType: request.payment.type,
                paymentCollectionAmount:
                  request.payment.collectionAmount === undefined
                    ? undefined
                    : numeric(request.payment.collectionAmount),
                paymentCurrency: request.payment.currency,
              }
            : {}),
        })
        .returning({ id: logisticsSearches.id });

      return { searchId: search.id };
    });
  }

  async getSearchOptions(searchId: string) {
    const [search] = await this.database
      .select({ id: logisticsSearches.id })
      .from(logisticsSearches)
      .where(eq(logisticsSearches.id, searchId))
      .limit(1);
    if (!search) return { status: "NOT_FOUND" as const, options: [] };

    const callbacks = await this.database
      .select({
        callbackId: onSearchCallbacks.id,
        bppId: onSearchCallbacks.bppId,
        bppUri: onSearchCallbacks.bppUri,
      })
      .from(onSearchCallbacks)
      .where(
        and(
          eq(onSearchCallbacks.searchId, search.id),
          eq(onSearchCallbacks.status, "processed"),
        ),
      );
    if (!callbacks.length) return { status: "PENDING" as const, options: [] };

    const options: Array<{
      bppId: string;
      bppUri?: string;
      providerId: string;
      provider: { code?: string; name?: string; short_desc?: string; long_desc?: string };
      locations: Array<{
        id: string;
        gps?: string;
        address?: Record<string, unknown>;
      }>;
      items: Array<{
        itemId: string;
        categoryId?: string;
        fulfillmentId?: string;
        descriptor?: {
          code?: string;
          name?: string;
          short_desc?: string;
          long_desc?: string;
        };
        price?: { currency?: string; value?: string };
        time?: { label?: string; duration?: string; timestamp?: string };
      }>;
      fulfillments: Array<{
        id: string;
        type?: string;
        start?: { time?: { duration?: string } };
        tags?: Array<{ code: string; list?: Array<{ code: string; value: string }> }>;
      }>;
    }> = [];

    for (const callback of callbacks) {
      const providerRows = await this.database
        .select({ id: searchProviders.id, providerId: searchProviders.providerId, name: searchProviders.name, shortDescription: searchProviders.shortDescription, longDescription: searchProviders.longDescription })
        .from(searchProviders)
        .where(eq(searchProviders.callbackId, callback.callbackId));

      for (const provider of providerRows) {
        const [locations, items, fulfillments] = await Promise.all([
          this.database
            .select({
              locationId: providerLocations.locationId,
              gps: providerLocations.gps,
              addressName: providerLocations.addressName,
              addressBuilding: providerLocations.addressBuilding,
              addressLocality: providerLocations.addressLocality,
              street: providerLocations.street,
              city: providerLocations.city,
              state: providerLocations.state,
              country: providerLocations.country,
              areaCode: providerLocations.areaCode,
            })
            .from(providerLocations)
            .where(eq(providerLocations.searchProviderRowId, provider.id)),
          this.database
            .select({
              catalogItemId: searchProviderItems.catalogItemId,
              parentItemId: searchProviderItems.parentItemId,
              categoryId: searchProviderItems.categoryId,
              fulfillmentId: searchProviderItems.fulfillmentId,
              descriptorCode: searchProviderItems.descriptorCode,
              name: searchProviderItems.name,
              shortDescription: searchProviderItems.shortDescription,
              longDescription: searchProviderItems.longDescription,
              tatLabel: searchProviderItems.tatLabel,
              tatDuration: searchProviderItems.tatDuration,
              tatTimestamp: searchProviderItems.tatTimestamp,
              priceAmount: searchProviderItems.priceAmount,
              priceCurrency: searchProviderItems.priceCurrency,
            })
            .from(searchProviderItems)
            .where(eq(searchProviderItems.providerRowId, provider.id)),
          this.database
            .select({
              id: searchProviderFulfillments.id,
              fulfillmentId: searchProviderFulfillments.fulfillmentId,
              type: searchProviderFulfillments.type,
              pickupDuration: searchProviderFulfillments.pickupDuration,
            })
            .from(searchProviderFulfillments)
            .where(eq(searchProviderFulfillments.providerRowId, provider.id)),
        ]);

        const fulfillmentsWithTags = await Promise.all(
          fulfillments.map(async (f) => {
            const tagRows = await this.database
              .select({
                tagId: tags.id,
                code: tags.code,
              })
              .from(tags)
              .where(eq(tags.searchProviderFulfillmentId, f.id));
            const fulfillmentTags = await Promise.all(
              tagRows.map(async (t) => ({
                code: t.code,
                list: (
                  await this.database
                    .select({
                      code: tagValues.code,
                      value: tagValues.value,
                    })
                    .from(tagValues)
                    .where(eq(tagValues.tagId, t.tagId))
                ).map((v) => ({ code: v.code, value: v.value ?? "" })),
              })),
            );
            return {
              id: f.fulfillmentId ?? "",
              type: f.type ?? undefined,
              ...(f.pickupDuration
                ? { start: { time: { duration: f.pickupDuration } } }
                : {}),
              ...(fulfillmentTags.length ? { tags: fulfillmentTags } : {}),
            };
          }),
        );

        options.push({
          bppId: callback.bppId,
          bppUri: callback.bppUri ?? undefined,
          providerId: provider.providerId,
          provider: {
            name: provider.name ?? undefined,
            short_desc: provider.shortDescription ?? undefined,
            long_desc: provider.longDescription ?? undefined,
          },
          locations: locations
            .filter((l): l is typeof l & { locationId: string } =>
              Boolean(l.locationId),
            )
            .map((l) => ({
              id: l.locationId,
              gps: l.gps ?? undefined,
              address: {
                name: l.addressName ?? undefined,
                building: l.addressBuilding ?? undefined,
                locality: l.addressLocality ?? undefined,
                street: l.street ?? undefined,
                city: l.city ?? undefined,
                state: l.state ?? undefined,
                country: l.country ?? undefined,
                area_code: l.areaCode ?? undefined,
              },
            })),
          items: items.map((item) => ({
            itemId: item.catalogItemId,
            categoryId: item.categoryId ?? undefined,
            fulfillmentId: item.fulfillmentId ?? undefined,
            descriptor: {
              code: item.descriptorCode ?? undefined,
              name: item.name ?? undefined,
              short_desc: item.shortDescription ?? undefined,
              long_desc: item.longDescription ?? undefined,
            },
            price: {
              currency: item.priceCurrency ?? undefined,
              value: item.priceAmount ?? undefined,
            },
            time: {
              label: item.tatLabel ?? undefined,
              duration: item.tatDuration ?? undefined,
              timestamp: item.tatTimestamp?.toISOString(),
            },
          })),
          fulfillments: fulfillmentsWithTags,
        });
      }
    }
    return { status: "READY" as const, options };
  }
  async updateTransactionStatus(
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
          eq(ondcTransactions.action, "search"),
        ),
      );
  }
}
