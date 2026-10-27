import type { AnyOrder } from "../repositories/logistics-order-shared.js";
import { buildStatusFulfillments } from "./status-event.mapper.js";
import { normalizeTags, tagListToRecord } from "../utils/ondc-tags.js";
import { compact } from "../utils/compact.js";

/** Fields for `*_error` stream events: code/message plus type/path when sent. */
export const errorFields = (error: AnyOrder) => ({
  code: error?.code as string | undefined,
  message: error?.message as string | undefined,
  ...(error?.type ? { type: error.type as string } : {}),
  ...(error?.path ? { path: error.path as string } : {}),
});

const price = (p: AnyOrder | undefined) =>
  compact({ amount: p?.value as string | undefined, currency: p?.currency as string | undefined });

const measure = (m: AnyOrder | undefined) =>
  compact({ unit: m?.unit as string | undefined, value: m?.value as number | string | undefined });

/**
 * Verbose order details shared by the order_confirmed / order_updated /
 * order_cancelled stream events: who (bpp), items, every fulfillment (state,
 * agent, vehicle, tracking, times, proof, RTO/pre-cancel tags), the quote
 * with its breakup (delivery/tax/rto/diff/tax_diff/discount), payment,
 * cancellation, cancellation terms, order bpp_terms and the linked order.
 * Read straight from the callback. Existing top-level event fields are kept
 * by the callers; this only adds.
 */
export const buildOrderEventDetails = (
  order: AnyOrder | undefined,
  context: { bpp_id?: string; bpp_uri?: string },
) => {
  if (!order) return {};
  // Callers spread this after their existing fields. The only overlapping
  // keys (quote, payment) are supersets of the established shapes with the
  // same values, so no existing field changes meaning.
  const tags = normalizeTags(order.tags);
  const linked = order["@ondc/org/linked_order"] as AnyOrder | undefined;
  const fulfillments = buildStatusFulfillments(order);
  // Same shape as init_result.quoteBreakups.
  const quoteBreakups = (
    Array.isArray(order.quote?.breakup) ? order.quote.breakup : []
  ).map((b: AnyOrder) =>
    compact({
      itemId: b["@ondc/org/item_id"] as string | undefined,
      titleType: b["@ondc/org/title_type"] as string | undefined,
      priceAmount: b.price?.value as string | undefined,
      priceCurrency: b.price?.currency as string | undefined,
    }),
  );
  const cancellationTerms = (
    Array.isArray(order.cancellation_terms) ? order.cancellation_terms : []
  ).map((t: AnyOrder) =>
    compact({
      fulfillmentState: t.fulfillment_state?.descriptor?.code as string | undefined,
      reasonCodes: t.fulfillment_state?.descriptor?.short_desc as string | undefined,
      feePercentage: t.cancellation_fee?.percentage as string | undefined,
      feeAmount: price(t.cancellation_fee?.amount),
    }),
  );
  return compact({
    bppId: context.bpp_id,
    bppUri: context.bpp_uri,
    createdAt: order.created_at as string | undefined,
    orderUpdatedAt: order.updated_at as string | undefined,
    items: Array.isArray(order.items) && order.items.length
      ? order.items.map((i: AnyOrder) =>
          compact({
            itemId: i.id as string | undefined,
            fulfillmentId: i.fulfillment_id as string | undefined,
            categoryId: i.category_id as string | undefined,
            descriptorCode: i.descriptor?.code as string | undefined,
            name: i.descriptor?.name as string | undefined,
            time: compact({
              label: i.time?.label as string | undefined,
              duration: i.time?.duration as string | undefined,
              timestamp: i.time?.timestamp as string | undefined,
            }),
          }),
        )
      : undefined,
    fulfillments: fulfillments.length ? fulfillments : undefined,
    // Same keys as the existing order_confirmed / init_result quote.
    quote: compact({
      priceAmount: order.quote?.price?.value as string | undefined,
      priceCurrency: order.quote?.price?.currency as string | undefined,
      ttl: order.quote?.ttl as string | undefined,
    }),
    quoteBreakups: quoteBreakups.length ? quoteBreakups : undefined,
    payment: compact({
      type: order.payment?.type as string | undefined,
      collectedBy: order.payment?.collected_by as string | undefined,
      status: order.payment?.status as string | undefined,
    }),
    cancellation: compact({
      cancelledBy: order.cancellation?.cancelled_by as string | undefined,
      reasonId: order.cancellation?.reason?.id as string | undefined,
    }),
    cancellationTerms: cancellationTerms.length ? cancellationTerms : undefined,
    bppTerms: tagListToRecord(tags, "bpp_terms"),
    linkedOrder: linked
      ? compact({
          retailOrderId: linked.order?.id as string | undefined,
          weight: measure(linked.order?.weight),
          dimensions: compact({
            length: measure(linked.order?.dimensions?.length),
            breadth: measure(linked.order?.dimensions?.breadth),
            height: measure(linked.order?.dimensions?.height),
          }),
          providerName: linked.provider?.descriptor?.name as string | undefined,
          items: Array.isArray(linked.items) && linked.items.length
            ? linked.items.map((i: AnyOrder) =>
                compact({
                  categoryId: i.category_id as string | undefined,
                  name: i.descriptor?.name as string | undefined,
                  count: i.quantity?.count as number | undefined,
                  measure: measure(i.quantity?.measure),
                  price: price(i.price),
                }),
              )
            : undefined,
        })
      : undefined,
    tags: tags.length ? tags : undefined,
  }) ?? {};
};
