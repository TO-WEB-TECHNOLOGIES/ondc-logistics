import { and, eq } from "drizzle-orm";
import { db1 } from "../db/index.js";
import {
  initOrderCancellationTerms,
  initOrderFulfillments,
  initOrderItems,
  initOrderLinkedOrderItems,
  initOrderQuoteBreakups,
  initOrderSettlements,
  initOrders,
  logisticsSearches,
  onSearchCallbacks,
  ondcTransactions,
  providerLocations,
  searchProviderFulfillments,
  searchProviderItems,
  searchProviders,
  tagValues,
  tags,
} from "../db/schema/index.js";
import { extractInitOrder } from "../mappers/init-persistence.mapper.js";
import { fetchSearchAddressNames } from "./init-order-reader.js";
import { clientStreamManager } from "../utils/client-stream.js";
import type {
  InitRequest,
  ResolvedInitSelection,
} from "../types/init/internal.js";
import type {
  OndcInitRequest,
  OndcOnInitResponse,
} from "../types/init/ondc.js";

const INIT_FULFILLMENT_TAG_CODES = new Set([
  "linked_provider",
  "fulfill_request",
  "fulfill_response",
  "linked_order",
  "special_req",
  "linked_package",
]);

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

export type Tx = Parameters<Parameters<typeof db1.transaction>[0]>[0];

// Inserts one init_orders snapshot (+ all child rows) for a transaction.
// Used for the 'init'/'on_init' snapshots (what we sent / what the BPP
// returned) and, by confirm.repository.ts, the 'confirm'/'on_confirm'
// snapshots — kept as separate rows per snapshot type so a field missing in
// a callback can be told apart from one explicitly present in what we sent.
export async function insertInitOrderSnapshot(
  tx: Tx,
  transactionDbId: string,
  snapshotType: "init" | "on_init" | "confirm" | "on_confirm",
  extracted: ReturnType<typeof extractInitOrder>,
) {
  const [row] = await tx
    .insert(initOrders)
    .values({
      transactionDbId,
      snapshotType,
      bppId: extracted.bppId,
      bppUri: extracted.bppUri,
      providerId: extracted.providerId,
      billingName: extracted.billing?.name,
      billingEmail: extracted.billing?.email,
      billingPhone: extracted.billing?.phone,
      billingTaxNumber: extracted.billing?.taxNumber,
      billingCreatedAt: extracted.billing?.createdAt
        ? new Date(extracted.billing.createdAt)
        : undefined,
      billingUpdatedAt: extracted.billing?.updatedAt
        ? new Date(extracted.billing.updatedAt)
        : undefined,
      billingAddressName: extracted.billing?.address?.name,
      billingAddressBuilding: extracted.billing?.address?.building,
      billingAddressLocality: extracted.billing?.address?.locality,
      billingAddressStreet: extracted.billing?.address?.street,
      billingAddressCity: extracted.billing?.address?.city,
      billingAddressState: extracted.billing?.address?.state,
      billingAddressCountry: extracted.billing?.address?.country,
      billingAddressAreaCode: extracted.billing?.address?.areaCode,
      paymentType: extracted.payment?.type,
      paymentCollectedBy: extracted.payment?.collectedBy,
      paymentCollectionAmount: extracted.payment?.collectionAmount,
      quotePriceAmount: extracted.quote?.priceAmount,
      quotePriceCurrency: extracted.quote?.priceCurrency,
      quoteTtl: extracted.quote?.ttl,
      orderCreatedAt: extracted.orderCreatedAt
        ? new Date(extracted.orderCreatedAt)
        : undefined,
      orderUpdatedAt: extracted.orderUpdatedAt
        ? new Date(extracted.orderUpdatedAt)
        : undefined,
      linkedOrderRetailOrderId: extracted.linkedOrder?.retailOrderId,
      linkedOrderWeightUnit: extracted.linkedOrder?.weightUnit,
      linkedOrderWeightValue: extracted.linkedOrder?.weightValue,
      linkedOrderLengthUnit: extracted.linkedOrder?.lengthUnit,
      linkedOrderLengthValue: extracted.linkedOrder?.lengthValue,
      linkedOrderBreadthUnit: extracted.linkedOrder?.breadthUnit,
      linkedOrderBreadthValue: extracted.linkedOrder?.breadthValue,
      linkedOrderHeightUnit: extracted.linkedOrder?.heightUnit,
      linkedOrderHeightValue: extracted.linkedOrder?.heightValue,
      linkedOrderProviderDescriptorName:
        extracted.linkedOrder?.providerDescriptorName,
      linkedOrderProviderAddressName: extracted.linkedOrder?.providerAddress?.name,
      linkedOrderProviderAddressBuilding:
        extracted.linkedOrder?.providerAddress?.building,
      linkedOrderProviderAddressLocality:
        extracted.linkedOrder?.providerAddress?.locality,
      linkedOrderProviderAddressCity: extracted.linkedOrder?.providerAddress?.city,
      linkedOrderProviderAddressState:
        extracted.linkedOrder?.providerAddress?.state,
      linkedOrderProviderAddressAreaCode:
        extracted.linkedOrder?.providerAddress?.areaCode,
    })
    .returning({ id: initOrders.id });
  const initOrderId = row.id;

  if (extracted.providerLocationIds.length)
    await tx.insert(providerLocations).values(
      extracted.providerLocationIds.map((locationId, position) => ({
        initOrderRowId: initOrderId,
        locationId,
        position,
      })),
    );

  if (extracted.items.length)
    await tx.insert(initOrderItems).values(
      extracted.items.map((item) => ({
        initOrderId,
        itemId: item.itemId,
        categoryId: item.categoryId,
        fulfillmentId: item.fulfillmentId,
        descriptorCode: item.descriptorCode,
        descriptorName: item.descriptorName,
        descriptorShortDesc: item.descriptorShortDesc,
        descriptorLongDesc: item.descriptorLongDesc,
        quantityCount: item.quantityCount,
        timeLabel: item.timeLabel,
        timeDuration: item.timeDuration,
        timeTimestamp: item.timeTimestamp ? new Date(item.timeTimestamp) : undefined,
      })),
    );

  for (const f of extracted.fulfillments) {
    const [fRow] = await tx
      .insert(initOrderFulfillments)
      .values({
        initOrderId,
        fulfillmentId: f.fulfillmentId,
        type: f.type,
        awbNo: f.awbNo,
        tracking: f.tracking,
        stateCode: f.stateCode,
        stateShortDesc: f.stateShortDesc,
        agentName: f.agentName,
        agentPhone: f.agentPhone,
        vehicleRegistration: f.vehicleRegistration,
        startGps: f.start.gps,
        startAddressName: f.start.address?.name,
        startAddressBuilding: f.start.address?.building,
        startAddressLocality: f.start.address?.locality,
        startAddressStreet: f.start.address?.street,
        startAddressCity: f.start.address?.city,
        startAddressState: f.start.address?.state,
        startAddressCountry: f.start.address?.country,
        startAddressAreaCode: f.start.address?.areaCode,
        startAuthorizationType: f.start.authorizationType,
        startContactPhone: f.start.contactPhone,
        startContactEmail: f.start.contactEmail,
        startPersonName: f.start.personName,
        startTimeDuration: f.start.timeDuration,
        startTimeTimestamp: f.start.timeTimestamp
          ? new Date(f.start.timeTimestamp)
          : undefined,
        startTimeRangeStart: f.start.timeRangeStart
          ? new Date(f.start.timeRangeStart)
          : undefined,
        startTimeRangeEnd: f.start.timeRangeEnd
          ? new Date(f.start.timeRangeEnd)
          : undefined,
        startInstructionCode: f.start.instructionCode,
        startInstructionShortDesc: f.start.instructionShortDesc,
        startInstructionLongDesc: f.start.instructionLongDesc,
        startInstructionAdditionalDescContentType:
          f.start.instructionAdditionalDescContentType,
        startInstructionAdditionalDescUrl: f.start.instructionAdditionalDescUrl,
        startInstructionImages: f.start.instructionImages.length
          ? f.start.instructionImages
          : undefined,
        endGps: f.end.gps,
        endAddressName: f.end.address?.name,
        endAddressBuilding: f.end.address?.building,
        endAddressLocality: f.end.address?.locality,
        endAddressStreet: f.end.address?.street,
        endAddressCity: f.end.address?.city,
        endAddressState: f.end.address?.state,
        endAddressCountry: f.end.address?.country,
        endAddressAreaCode: f.end.address?.areaCode,
        endAuthorizationType: f.end.authorizationType,
        endContactPhone: f.end.contactPhone,
        endContactEmail: f.end.contactEmail,
        endPersonName: f.end.personName,
        endTimeDuration: f.end.timeDuration,
        endTimeTimestamp: f.end.timeTimestamp
          ? new Date(f.end.timeTimestamp)
          : undefined,
        endTimeRangeStart: f.end.timeRangeStart
          ? new Date(f.end.timeRangeStart)
          : undefined,
        endTimeRangeEnd: f.end.timeRangeEnd
          ? new Date(f.end.timeRangeEnd)
          : undefined,
        endInstructionCode: f.end.instructionCode,
        endInstructionShortDesc: f.end.instructionShortDesc,
        endInstructionLongDesc: f.end.instructionLongDesc,
        endInstructionAdditionalDescContentType:
          f.end.instructionAdditionalDescContentType,
        endInstructionAdditionalDescUrl: f.end.instructionAdditionalDescUrl,
        endInstructionImages: f.end.instructionImages.length
          ? f.end.instructionImages
          : undefined,
      })
      .returning({ id: initOrderFulfillments.id });

    for (const t of f.tags) {
      const [tagRow] = await tx
        .insert(tags)
        .values({ initOrderFulfillmentId: fRow.id, code: t.code })
        .returning({ id: tags.id });
      if (t.list.length)
        await tx.insert(tagValues).values(
          t.list.map((v) => ({ tagId: tagRow.id, code: v.code, value: v.value })),
        );
    }
  }

  if (extracted.quoteBreakups.length)
    await tx.insert(initOrderQuoteBreakups).values(
      extracted.quoteBreakups.map((b) => ({
        initOrderId,
        itemId: b.itemId,
        titleType: b.titleType,
        priceAmount: b.priceAmount,
        priceCurrency: b.priceCurrency,
      })),
    );

  if (extracted.settlements.length)
    await tx.insert(initOrderSettlements).values(
      extracted.settlements.map((s) => ({
        initOrderId,
        settlementCounterparty: s.settlementCounterparty,
        settlementType: s.settlementType,
        beneficiaryName: s.beneficiaryName,
        upiAddress: s.upiAddress,
        settlementBankAccountNo: s.settlementBankAccountNo,
        settlementIfscCode: s.settlementIfscCode,
        settlementStatus: s.settlementStatus,
        settlementReference: s.settlementReference,
        settlementTimestamp: s.settlementTimestamp
          ? new Date(s.settlementTimestamp)
          : undefined,
      })),
    );

  if (extracted.cancellationTerms.length)
    await tx.insert(initOrderCancellationTerms).values(
      extracted.cancellationTerms.map((c) => ({
        initOrderId,
        fulfillmentStateCode: c.fulfillmentStateCode,
        fulfillmentStateShortDesc: c.fulfillmentStateShortDesc,
        cancellationFeePercentage: c.cancellationFeePercentage,
        cancellationFeeAmount: c.cancellationFeeAmount,
        cancellationFeeCurrency: c.cancellationFeeCurrency,
      })),
    );

  for (const t of extracted.tags) {
    const [tagRow] = await tx
      .insert(tags)
      .values({ initOrderId, code: t.code })
      .returning({ id: tags.id });
    if (t.list.length)
      await tx.insert(tagValues).values(
        t.list.map((v) => ({ tagId: tagRow.id, code: v.code, value: v.value })),
      );
  }

  if (extracted.linkedOrder?.items.length)
    await tx.insert(initOrderLinkedOrderItems).values(
      extracted.linkedOrder.items.map((item) => ({
        initOrderId,
        descriptorName: item.descriptorName,
        quantityCount: item.quantityCount,
        quantityMeasureUnit: item.quantityMeasureUnit,
        quantityMeasureValue: item.quantityMeasureValue,
        priceAmount: item.priceAmount,
        priceCurrency: item.priceCurrency,
      })),
    );

  return initOrderId;
}

export class DrizzleInitRepository implements InitRepository {
  constructor(private readonly database: typeof db1 = db1) {}

  async resolveSelection(request: InitRequest) {
    const [search] = await this.database
      .select({
        searchId: logisticsSearches.id,
        transactionId: ondcTransactions.transactionId,
        authorizationStartType: logisticsSearches.authorizationStartType,
        authorizationEndType: logisticsSearches.authorizationEndType,
        startGps: logisticsSearches.startGps,
        startAddressName: logisticsSearches.startAddressName,
        startAddressBuilding: logisticsSearches.startAddressBuilding,
        startAddressLocality: logisticsSearches.startAddressLocality,
        startAddressStreet: logisticsSearches.startAddressStreet,
        startAddressCity: logisticsSearches.startAddressCity,
        startAddressState: logisticsSearches.startAddressState,
        startAddressCountry: logisticsSearches.startAddressCountry,
        startAreaCode: logisticsSearches.startAreaCode,
        endGps: logisticsSearches.endGps,
        endAddressName: logisticsSearches.endAddressName,
        endAddressBuilding: logisticsSearches.endAddressBuilding,
        endAddressLocality: logisticsSearches.endAddressLocality,
        endAddressStreet: logisticsSearches.endAddressStreet,
        endAddressCity: logisticsSearches.endAddressCity,
        endAddressState: logisticsSearches.endAddressState,
        endAddressCountry: logisticsSearches.endAddressCountry,
        endAreaCode: logisticsSearches.endAreaCode,
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
        callbackId: onSearchCallbacks.id,
        bppId: onSearchCallbacks.bppId,
        bppUri: onSearchCallbacks.bppUri,
      })
      .from(onSearchCallbacks)
      .where(
        and(
          eq(onSearchCallbacks.searchId, search.searchId),
          eq(onSearchCallbacks.status, "processed"),
        ),
      );
    if (!callbacks.length) return { status: "not_ready" as const };
    if (request.bppId) {
      const filtered = callbacks.filter((c) => c.bppId === request.bppId);
      callbacks.length = 0;
      callbacks.push(...filtered);
    }
    if (!callbacks.length) return { status: "not_found" as const };

    const candidates: ResolvedInitSelection[] = [];
    for (const callback of callbacks) {
      const providerRows = await this.database
        .select({ id: searchProviders.id, providerId: searchProviders.providerId })
        .from(searchProviders)
        .where(
          and(
            eq(searchProviders.callbackId, callback.callbackId),
            ...(request.providerId
              ? [eq(searchProviders.providerId, request.providerId)]
              : []),
          ),
        );
      for (const providerRow of providerRows) {
        const [fulfillments, items, providerLocationRows] = await Promise.all([
          this.database
            .select({
              id: searchProviderFulfillments.id,
              fulfillmentId: searchProviderFulfillments.fulfillmentId,
              type: searchProviderFulfillments.type,
            })
            .from(searchProviderFulfillments)
            .where(eq(searchProviderFulfillments.providerRowId, providerRow.id)),
          this.database
            .select({
              catalogItemId: searchProviderItems.catalogItemId,
              fulfillmentId: searchProviderItems.fulfillmentId,
              categoryId: searchProviderItems.categoryId,
              descriptorCode: searchProviderItems.descriptorCode,
              name: searchProviderItems.name,
              shortDescription: searchProviderItems.shortDescription,
              longDescription: searchProviderItems.longDescription,
              tatLabel: searchProviderItems.tatLabel,
              tatDuration: searchProviderItems.tatDuration,
              tatTimestamp: searchProviderItems.tatTimestamp,
            })
            .from(searchProviderItems)
            .where(eq(searchProviderItems.providerRowId, providerRow.id)),
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
            .where(eq(providerLocations.searchProviderRowId, providerRow.id)),
        ]);

        const fulfillmentTagsByRowId = new Map<
          string,
          Array<{ code: string; list: Array<{ code: string; value: string }> }>
        >();
        for (const fulfillmentRow of fulfillments) {
          const tagRows = await this.database
            .select({
              tagId: tags.id,
              code: tags.code,
            })
            .from(tags)
            .where(eq(tags.searchProviderFulfillmentId, fulfillmentRow.id));
          const fulfillmentTags: Array<{
            code: string;
            list: Array<{ code: string; value: string }>;
          }> = [];
          for (const tagRow of tagRows) {
            const values = await this.database
              .select({
                code: tagValues.code,
                value: tagValues.value,
              })
              .from(tagValues)
              .where(eq(tagValues.tagId, tagRow.tagId));
            fulfillmentTags.push({
              code: tagRow.code,
              list: values.map((v) => ({ code: v.code, value: v.value ?? "" })),
            });
          }
          fulfillmentTagsByRowId.set(fulfillmentRow.id, fulfillmentTags);
        }

        for (const item of items) {
          if (request.itemId && item.catalogItemId !== request.itemId) continue;
          for (const fulfillment of fulfillments) {
            if (item.fulfillmentId && item.fulfillmentId !== fulfillment.fulfillmentId)
              continue;
            if (
              request.fulfillmentId &&
              fulfillment.fulfillmentId !== request.fulfillmentId
            )
              continue;
            if (!fulfillment.fulfillmentId) continue;
            candidates.push({
              searchTransactionId: search.transactionId,
              bppId: callback.bppId,
              bppUri: callback.bppUri ?? "",
              provider: { id: providerRow.providerId },
              providerLocations: providerLocationRows
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
                    areaCode: l.areaCode ?? "",
                  },
                })),
              item: {
                id: item.catalogItemId,
                fulfillmentId: item.fulfillmentId ?? undefined,
                categoryId: item.categoryId ?? undefined,
                descriptor: {
                  code: item.descriptorCode ?? undefined,
                  name: item.name ?? undefined,
                  shortDesc: item.shortDescription ?? undefined,
                  longDesc: item.longDescription ?? undefined,
                },
                time: item.tatLabel || item.tatDuration || item.tatTimestamp
                  ? {
                      label: item.tatLabel ?? undefined,
                      duration: item.tatDuration ?? undefined,
                      timestamp: item.tatTimestamp?.toISOString(),
                    }
                  : undefined,
              },
              fulfillment: {
                id: fulfillment.fulfillmentId,
                type: fulfillment.type ?? undefined,
                tags: fulfillmentTagsByRowId.get(fulfillment.id) ?? [],
              },
              searchEnvelope: {
                start: {
                  gps: search.startGps ?? "",
                  address: {
                    name: search.startAddressName ?? undefined,
                    building: search.startAddressBuilding ?? undefined,
                    locality: search.startAddressLocality ?? undefined,
                    street: search.startAddressStreet ?? undefined,
                    city: search.startAddressCity ?? undefined,
                    state: search.startAddressState ?? undefined,
                    country: search.startAddressCountry ?? undefined,
                    areaCode: search.startAreaCode ?? "",
                  },
                  authorizationType: search.authorizationStartType ?? "OTP",
                },
                end: {
                  gps: search.endGps ?? "",
                  address: {
                    name: search.endAddressName ?? undefined,
                    building: search.endAddressBuilding ?? undefined,
                    locality: search.endAddressLocality ?? undefined,
                    street: search.endAddressStreet ?? undefined,
                    city: search.endAddressCity ?? undefined,
                    state: search.endAddressState ?? undefined,
                    country: search.endAddressCountry ?? undefined,
                    areaCode: search.endAreaCode ?? "",
                  },
                  authorizationType: search.authorizationEndType ?? "OTP",
                },
              },
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

    const withFilteredTags = unique[0];
    return {
      status: "ok" as const,
      selection: {
        ...withFilteredTags,
        fulfillment: {
          ...withFilteredTags.fulfillment,
          tags: withFilteredTags.fulfillment.tags.filter((tag) =>
            INIT_FULFILLMENT_TAG_CODES.has(tag.code),
          ),
        },
      },
    };
  }

  async create(payload: OndcInitRequest) {
    const payment = payload.message.order.payment as
      | Record<string, unknown>
      | undefined;
    const normalizedPaymentType = String(payment?.type ?? "")
      .toUpperCase()
      .replace(/_/g, "-");
    if (normalizedPaymentType === "ON-FULFILLMENT") {
      const settlementDetails = payment?.["@ondc/org/settlement_details"];
      if (!Array.isArray(settlementDetails) || settlementDetails.length === 0)
        throw new Error(
          "payment.@ondc/org/settlement_details is required and must be non-empty when payment.type is ON-FULFILLMENT",
        );
    }
    const personNames = await fetchSearchAddressNames(
      this.database,
      payload.context.transaction_id,
    );
    return this.database.transaction(async (tx) => {
      const [row] = await tx
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
        })
        .returning({ id: ondcTransactions.id });

      const extracted = extractInitOrder(
        payload.message.order,
        { bppId: payload.context.bpp_id, bppUri: payload.context.bpp_uri },
        personNames,
      );
      await insertInitOrderSnapshot(tx, row.id, "init", extracted);

      return { initId: row.id };
    });
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

    const personNames = await fetchSearchAddressNames(
      this.database,
      c.transaction_id,
    );
    let extracted: ReturnType<typeof extractInitOrder> | undefined;
    await this.database.transaction(async (tx) => {
      if (response.message?.order) {
        // Replace any prior on_init snapshot (e.g. a corrected callback for
        // the same transaction) rather than leaving stale child rows behind.
        await tx
          .delete(initOrders)
          .where(
            and(
              eq(initOrders.transactionDbId, row.id),
              eq(initOrders.snapshotType, "on_init"),
            ),
          );
        extracted = extractInitOrder(
          response.message.order,
          { bppId: c.bpp_id, bppUri: c.bpp_uri },
          personNames,
        );
        await insertInitOrderSnapshot(tx, row.id, "on_init", extracted);
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

    if (response.error) {
      clientStreamManager.push(c.transaction_id, "init_error", {
        code: response.error.code,
        message: response.error.message,
      });
    } else if (extracted) {
      clientStreamManager.push(c.transaction_id, "init_result", {
        providerId: extracted.providerId,
        items: extracted.items.map((item) => ({
          itemId: item.itemId,
          name: item.descriptorName,
          fulfillmentId: item.fulfillmentId,
          quantityCount: item.quantityCount,
        })),
        fulfillments: extracted.fulfillments.map((f) => ({
          fulfillmentId: f.fulfillmentId,
          type: f.type,
        })),
        quote: extracted.quote,
        quoteBreakups: extracted.quoteBreakups,
        cancellationTerms: extracted.cancellationTerms,
      });
    }
    return "processed" as const;
  }
}
