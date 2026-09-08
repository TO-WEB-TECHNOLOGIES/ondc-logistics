import { eq } from "drizzle-orm";
import { db1 } from "../db/index.js";
import {
  initOrderCancellationTerms,
  initOrderFulfillments,
  initOrderItems,
  initOrderLinkedOrderItems,
  initOrderQuoteBreakups,
  initOrderSettlements,
  initOrders,
  providerLocations,
  tagValues,
  tags,
} from "../db/schema/index.js";
import type { FetchedInitOrder } from "../mappers/init-persistence.mapper.js";

// Reconstructs everything an init_orders snapshot (+ children) holds, in the
// shape init-persistence.mapper#buildOndcInitOrder expects. Shared by any
// repository that needs the full /init or /on_init order object back
// (currently confirm.repository.ts) without ever touching a JSON payload
// column.
export async function fetchInitOrderSnapshot(
  database: typeof db1,
  transactionDbId: string,
  snapshotType: "init" | "on_init",
): Promise<FetchedInitOrder | undefined> {
  const orderRows = await database
    .select()
    .from(initOrders)
    .where(eq(initOrders.transactionDbId, transactionDbId));
  const snapshot = orderRows.find((r) => r.snapshotType === snapshotType);
  if (!snapshot) return undefined;

  const initOrderId = snapshot.id;

  const [
    providerLocationRows,
    itemRows,
    fulfillmentRows,
    quoteBreakupRows,
    settlementRows,
    cancellationRows,
    orderTagRows,
    linkedOrderItemRows,
  ] = await Promise.all([
    database
      .select()
      .from(providerLocations)
      .where(eq(providerLocations.initOrderRowId, initOrderId)),
    database.select().from(initOrderItems).where(eq(initOrderItems.initOrderId, initOrderId)),
    database
      .select()
      .from(initOrderFulfillments)
      .where(eq(initOrderFulfillments.initOrderId, initOrderId)),
    database
      .select()
      .from(initOrderQuoteBreakups)
      .where(eq(initOrderQuoteBreakups.initOrderId, initOrderId)),
    database
      .select()
      .from(initOrderSettlements)
      .where(eq(initOrderSettlements.initOrderId, initOrderId)),
    database
      .select()
      .from(initOrderCancellationTerms)
      .where(eq(initOrderCancellationTerms.initOrderId, initOrderId)),
    database.select().from(tags).where(eq(tags.initOrderId, initOrderId)),
    database
      .select()
      .from(initOrderLinkedOrderItems)
      .where(eq(initOrderLinkedOrderItems.initOrderId, initOrderId)),
  ]);

  const orderTagValueRows = await Promise.all(
    orderTagRows.map((t) =>
      database.select().from(tagValues).where(eq(tagValues.tagId, t.id)),
    ),
  );

  const fulfillments = await Promise.all(
    fulfillmentRows.map(async (f) => {
      const fulfillmentTagRows = await database
        .select()
        .from(tags)
        .where(eq(tags.initOrderFulfillmentId, f.id));
      const fulfillmentTagValueRows = await Promise.all(
        fulfillmentTagRows.map((t) =>
          database.select().from(tagValues).where(eq(tagValues.tagId, t.id)),
        ),
      );
      return {
        fulfillmentId: f.fulfillmentId,
        type: f.type,
        awbNo: f.awbNo,
        tracking: f.tracking,
        stateCode: f.stateCode,
        stateShortDesc: f.stateShortDesc,
        start: {
          gps: f.startGps,
          addressName: f.startAddressName,
          addressBuilding: f.startAddressBuilding,
          addressLocality: f.startAddressLocality,
          addressStreet: f.startAddressStreet,
          addressCity: f.startAddressCity,
          addressState: f.startAddressState,
          addressCountry: f.startAddressCountry,
          addressAreaCode: f.startAddressAreaCode,
          authorizationType: f.startAuthorizationType,
          contactPhone: f.startContactPhone,
          contactEmail: f.startContactEmail,
          personName: f.startPersonName,
          agentName: f.startAgentName,
          agentPhone: f.startAgentPhone,
          vehicleRegistration: f.startVehicleRegistration,
          timeDuration: f.startTimeDuration,
          timeTimestamp: f.startTimeTimestamp,
          timeRangeStart: f.startTimeRangeStart,
          timeRangeEnd: f.startTimeRangeEnd,
          instructionCode: f.startInstructionCode,
          instructionShortDesc: f.startInstructionShortDesc,
          instructionLongDesc: f.startInstructionLongDesc,
          instructionAdditionalDescContentType:
            f.startInstructionAdditionalDescContentType,
          instructionAdditionalDescUrl: f.startInstructionAdditionalDescUrl,
          instructionImages: f.startInstructionImages ?? [],
        },
        end: {
          gps: f.endGps,
          addressName: f.endAddressName,
          addressBuilding: f.endAddressBuilding,
          addressLocality: f.endAddressLocality,
          addressStreet: f.endAddressStreet,
          addressCity: f.endAddressCity,
          addressState: f.endAddressState,
          addressCountry: f.endAddressCountry,
          addressAreaCode: f.endAddressAreaCode,
          authorizationType: f.endAuthorizationType,
          contactPhone: f.endContactPhone,
          contactEmail: f.endContactEmail,
          personName: f.endPersonName,
          agentName: f.endAgentName,
          agentPhone: f.endAgentPhone,
          vehicleRegistration: f.endVehicleRegistration,
          timeDuration: f.endTimeDuration,
          timeTimestamp: f.endTimeTimestamp,
          timeRangeStart: f.endTimeRangeStart,
          timeRangeEnd: f.endTimeRangeEnd,
          instructionCode: f.endInstructionCode,
          instructionShortDesc: f.endInstructionShortDesc,
          instructionLongDesc: f.endInstructionLongDesc,
          instructionAdditionalDescContentType:
            f.endInstructionAdditionalDescContentType,
          instructionAdditionalDescUrl: f.endInstructionAdditionalDescUrl,
          instructionImages: f.endInstructionImages ?? [],
        },
        tags: fulfillmentTagRows.map((t, i) => ({
          code: t.code,
          values: fulfillmentTagValueRows[i].map((v) => ({
            code: v.code,
            value: v.value,
          })),
        })),
      };
    }),
  );

  const hasLinkedOrder =
    Boolean(snapshot.linkedOrderRetailOrderId) || linkedOrderItemRows.length > 0;
  const linkedOrder = hasLinkedOrder
    ? {
        retailOrderId: snapshot.linkedOrderRetailOrderId,
        weightUnit: snapshot.linkedOrderWeightUnit,
        weightValue: snapshot.linkedOrderWeightValue,
        lengthUnit: snapshot.linkedOrderLengthUnit,
        lengthValue: snapshot.linkedOrderLengthValue,
        breadthUnit: snapshot.linkedOrderBreadthUnit,
        breadthValue: snapshot.linkedOrderBreadthValue,
        heightUnit: snapshot.linkedOrderHeightUnit,
        heightValue: snapshot.linkedOrderHeightValue,
        providerDescriptorName: snapshot.linkedOrderProviderDescriptorName,
        providerAddressName: snapshot.linkedOrderProviderAddressName,
        providerAddressBuilding: snapshot.linkedOrderProviderAddressBuilding,
        providerAddressLocality: snapshot.linkedOrderProviderAddressLocality,
        providerAddressCity: snapshot.linkedOrderProviderAddressCity,
        providerAddressState: snapshot.linkedOrderProviderAddressState,
        providerAddressAreaCode: snapshot.linkedOrderProviderAddressAreaCode,
        items: linkedOrderItemRows.map((item) => ({
          descriptorName: item.descriptorName,
          quantityCount: item.quantityCount,
          quantityMeasureUnit: item.quantityMeasureUnit,
          quantityMeasureValue: item.quantityMeasureValue,
          priceAmount: item.priceAmount,
          priceCurrency: item.priceCurrency,
        })),
      }
    : undefined;

  const result: FetchedInitOrder = {
    providerId: snapshot.providerId ?? "",
    providerLocationIds: providerLocationRows
      .sort((a, b) => a.position - b.position)
      .map((l) => l.locationId),
    billingName: snapshot.billingName,
    billingEmail: snapshot.billingEmail,
    billingPhone: snapshot.billingPhone,
    billingTaxNumber: snapshot.billingTaxNumber,
    billingCreatedAt: snapshot.billingCreatedAt,
    billingUpdatedAt: snapshot.billingUpdatedAt,
    billingAddressName: snapshot.billingAddressName,
    billingAddressBuilding: snapshot.billingAddressBuilding,
    billingAddressLocality: snapshot.billingAddressLocality,
    billingAddressStreet: snapshot.billingAddressStreet,
    billingAddressCity: snapshot.billingAddressCity,
    billingAddressState: snapshot.billingAddressState,
    billingAddressCountry: snapshot.billingAddressCountry,
    billingAddressAreaCode: snapshot.billingAddressAreaCode,
    paymentType: snapshot.paymentType,
    paymentCollectedBy: snapshot.paymentCollectedBy,
    paymentCollectionAmount: snapshot.paymentCollectionAmount,
    quotePriceAmount: snapshot.quotePriceAmount,
    quotePriceCurrency: snapshot.quotePriceCurrency,
    quoteTtl: snapshot.quoteTtl,
    orderCreatedAt: snapshot.orderCreatedAt,
    orderUpdatedAt: snapshot.orderUpdatedAt,
    items: itemRows.map((item) => ({
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
      timeTimestamp: item.timeTimestamp,
    })),
    fulfillments,
    quoteBreakups: quoteBreakupRows.map((b) => ({
      itemId: b.itemId,
      titleType: b.titleType,
      priceAmount: b.priceAmount,
      priceCurrency: b.priceCurrency,
    })),
    settlements: settlementRows.map((s) => ({
      settlementCounterparty: s.settlementCounterparty,
      settlementType: s.settlementType,
      beneficiaryName: s.beneficiaryName,
      upiAddress: s.upiAddress,
      settlementBankAccountNo: s.settlementBankAccountNo,
      settlementIfscCode: s.settlementIfscCode,
      settlementStatus: s.settlementStatus,
      settlementReference: s.settlementReference,
      settlementTimestamp: s.settlementTimestamp,
    })),
    cancellationTerms: cancellationRows.map((c) => ({
      fulfillmentStateCode: c.fulfillmentStateCode,
      fulfillmentStateShortDesc: c.fulfillmentStateShortDesc,
      cancellationFeePercentage: c.cancellationFeePercentage,
      cancellationFeeAmount: c.cancellationFeeAmount,
      cancellationFeeCurrency: c.cancellationFeeCurrency,
    })),
    tags: orderTagRows.map((t, i) => ({
      code: t.code,
      values: orderTagValueRows[i].map((v) => ({ code: v.code, value: v.value })),
    })),
    linkedOrder,
  };
  return result;
}
