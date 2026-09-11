import { eq } from "drizzle-orm";
import { db1 } from "../db/index.js";
import { logisticsOrder, tagValues, tags } from "../db/schema/index.js";
import type { OndcTag } from "../types/search/ondc.js";

export type Tx = Parameters<Parameters<typeof db1.transaction>[0]>[0];
export type LogisticsOrderRow = typeof logisticsOrder.$inferSelect;
// Loosely typed: the outbound orders we build (confirm/status) and the
// inbound orders a BPP returns (on_confirm/on_status) share this shape
// closely enough that a single extractor covers all of them.
export type AnyOrder = Record<string, any>;

/** Loads the current logistics_order row for an order_id, if any. */
export const loadLogisticsOrder = async (
  database: typeof db1,
  orderId: string,
): Promise<LogisticsOrderRow | undefined> => {
  const [row] = await database
    .select()
    .from(logisticsOrder)
    .where(eq(logisticsOrder.orderId, orderId))
    .limit(1);
  return row;
};

/**
 * Flattens a confirm/on_confirm/on_status order object into logistics_order's
 * typed columns. Single primary item/fulfillment/linked-order-item per order
 * (see logistics-order.schema.ts) — a second item/fulfillment/linked line
 * isn't representable here. Authorization token/valid_from/valid_to are
 * deliberately NOT extracted here — those are populated by /update when the
 * frontend sends an OTP, not by /confirm|/on_confirm|/on_status.
 */
export const buildLogisticsOrderColumns = (order: AnyOrder) => {
  const item = Array.isArray(order.items) ? order.items[0] : undefined;
  const fulfillment = Array.isArray(order.fulfillments)
    ? order.fulfillments[0]
    : undefined;
  const linkedOrder = order["@ondc/org/linked_order"];
  const linkedItem = Array.isArray(linkedOrder?.items)
    ? linkedOrder.items[0]
    : undefined;
  const linkedRetailOrder = linkedOrder?.order;

  return {
    providerId: order.provider?.id,
    state: order.state,
    orderCreatedAt: order.created_at ? new Date(order.created_at) : undefined,
    orderUpdatedAt: order.updated_at ? new Date(order.updated_at) : undefined,

    itemId: item?.id,
    itemCategoryId: item?.category_id,
    itemDescriptorCode: item?.descriptor?.code,
    itemDescriptorName: item?.descriptor?.name,
    itemQuantityCount: item?.quantity?.count,

    fulfillmentId: fulfillment?.id,
    fulfillmentType: fulfillment?.type,
    awbNo: fulfillment?.["@ondc/org/awb_no"],
    fulfillmentStateCode: fulfillment?.state?.descriptor?.code,
    fulfillmentStateShortDesc: fulfillment?.state?.descriptor?.short_desc,

    startInstructionCode: fulfillment?.start?.instructions?.code,
    startInstructionShortDesc: fulfillment?.start?.instructions?.short_desc,
    startInstructionLongDesc: fulfillment?.start?.instructions?.long_desc,
    startInstructionImages: fulfillment?.start?.instructions?.images,
    endInstructionCode: fulfillment?.end?.instructions?.code,
    endInstructionShortDesc: fulfillment?.end?.instructions?.short_desc,
    endInstructionLongDesc: fulfillment?.end?.instructions?.long_desc,
    endInstructionImages: fulfillment?.end?.instructions?.images,

    startAuthorizationType: fulfillment?.start?.authorization?.type,
    endAuthorizationType: fulfillment?.end?.authorization?.type,

    quotePriceAmount: order.quote?.price?.value,
    quotePriceCurrency: order.quote?.price?.currency,

    billingName: order.billing?.name,
    billingEmail: order.billing?.email,
    billingPhone: order.billing?.phone,

    paymentType: order.payment?.type,
    paymentCollectedBy: order.payment?.collected_by,
    paymentCollectionAmount: order.payment?.["@ondc/org/collection_amount"],

    linkedOrderRetailOrderId: linkedRetailOrder?.id,
    linkedOrderProductName: linkedItem?.descriptor?.name,
    linkedOrderQuantityCount: linkedItem?.quantity?.count,
    linkedOrderWeightUnit: linkedRetailOrder?.weight?.unit,
    linkedOrderWeightValue: linkedRetailOrder?.weight?.value,
    linkedOrderLengthUnit: linkedRetailOrder?.dimensions?.length?.unit,
    linkedOrderLengthValue: linkedRetailOrder?.dimensions?.length?.value,
    linkedOrderBreadthUnit: linkedRetailOrder?.dimensions?.breadth?.unit,
    linkedOrderBreadthValue: linkedRetailOrder?.dimensions?.breadth?.value,
    linkedOrderHeightUnit: linkedRetailOrder?.dimensions?.height?.unit,
    linkedOrderHeightValue: linkedRetailOrder?.dimensions?.height?.value,
    linkedOrderProviderName: linkedOrder?.provider?.descriptor?.name,
  };
};

/**
 * Flattens an /on_track message.tracking object into logistics_order's
 * tracking snapshot columns — latest position/status/url only. The
 * breadcrumb `path` tags are intentionally excluded (see schema comment);
 * callers that want them should read them off the raw callback/SSE event,
 * not the DB.
 */
export const buildTrackingColumns = (tracking: AnyOrder) => ({
  trackingUrl: tracking?.url,
  trackingStatus: tracking?.status,
  trackingGps: tracking?.location?.gps,
  trackingLocationTimestamp: tracking?.location?.time?.timestamp
    ? new Date(tracking.location.time.timestamp)
    : undefined,
  trackingUpdatedAt: tracking?.location?.updated_at
    ? new Date(tracking.location.updated_at)
    : undefined,
});

/**
 * Replaces logistics_order's tags (order-level + the primary fulfillment's
 * tags — e.g. "state"/ready_to_ship, or on_status's tracking/
 * fulfillment_delay/reverseqc_output codes) via the shared tags/tag_values
 * tables, per logisticsOrderId. Delete-then-reinsert, same "replace prior
 * state" pattern used elsewhere in this codebase for callback-driven data.
 */
export const syncLogisticsOrderTags = async (
  tx: Tx,
  orderId: string,
  order: AnyOrder,
) => {
  await tx.delete(tags).where(eq(tags.logisticsOrderId, orderId));
  const fulfillment = Array.isArray(order.fulfillments)
    ? order.fulfillments[0]
    : undefined;
  const allTags = [
    ...(Array.isArray(order.tags) ? order.tags : []),
    ...(Array.isArray(fulfillment?.tags) ? fulfillment.tags : []),
  ];
  for (const tag of allTags) {
    if (!tag?.code) continue;
    const [tagRow] = await tx
      .insert(tags)
      .values({ logisticsOrderId: orderId, code: tag.code })
      .returning({ id: tags.id });
    const list = Array.isArray(tag.list) ? tag.list : [];
    if (list.length)
      await tx
        .insert(tagValues)
        .values(list.map((v: any) => ({ tagId: tagRow.id, code: v.code, value: v.value })));
  }
};

/** Currently stored order/fulfillment tags for this order. */
export const loadFulfillmentTags = async (
  database: typeof db1,
  orderId: string,
): Promise<OndcTag[]> => {
  const tagRows = await database
    .select({ id: tags.id, code: tags.code })
    .from(tags)
    .where(eq(tags.logisticsOrderId, orderId));
  const result: OndcTag[] = [];
  for (const tagRow of tagRows) {
    const values = await database
      .select({ code: tagValues.code, value: tagValues.value })
      .from(tagValues)
      .where(eq(tagValues.tagId, tagRow.id));
    result.push({
      code: tagRow.code,
      ...(values.length
        ? { list: values.map((v) => ({ code: v.code, value: v.value ?? "" })) }
        : {}),
    });
  }
  return result;
};
