/**
 * Mapping/data-shaping for the /confirm flow.
 *
 * Contract reference: docs/ondc/ondc logistics.docx, "/confirm" sample.
 *
 * Responsibility boundary: this file only shapes data (merging /init +
 * /on_init state, folding in confirm-time-only fields, building the wire
 * payload). State-consistency validation (confirm request vs. initialized
 * transaction) stays in confirm.service.ts.
 */
import { buildRequestContext } from "../utils/ondc-context.js";
import type { OndcConfirmOrder, OndcConfirmRequest } from "../types/confirm/ondc.js";
import type { ConfirmRequest } from "../types/confirm/internal.js";
import type { OndcInitFulfillment, OndcInitOrder } from "../types/init/ondc.js";
import type { OndcContext } from "../types/search/ondc.js";

/**
 * Translates the minimal public ConfirmRequest into the ONDC-shaped partial
 * order buildConfirmOrder expects as `suppliedOrder`. `linkedOrder` and
 * `fulfillments` are the only fields the caller can supply today (see
 * types/confirm/internal.ts) — tags/created_at are left unset so
 * buildConfirmOrder falls through to the initialized transaction's values
 * for those.
 */
export const toSuppliedOrder = (input: ConfirmRequest): Record<string, any> => ({
  ...(input.linkedOrder ? { "@ondc/org/linked_order": input.linkedOrder } : {}),
  ...(input.fulfillments ? { fulfillments: input.fulfillments } : {}),
});

/**
 * Merges an array of stored objects with a caller-supplied array of the same
 * shape, matching by `id`. Fields in `immutableKeys` are always taken from
 * `stored` even if the caller supplied a different value, so a confirm
 * request can't silently overwrite identity-bearing fields from /init.
 */
export const mergeById = (
  stored: any[],
  supplied: unknown,
  immutableKeys: string[],
) => {
  if (!Array.isArray(supplied)) return stored;
  return stored.map((item: any, index: number) => {
    const extra = (
      supplied[index] && typeof supplied[index] === "object"
        ? supplied[index]
        : {}
    ) as any;
    const match = supplied.find((candidate: any) => candidate?.id === item.id);
    const supplement = match ?? extra;
    const result = { ...item, ...supplement };
    for (const key of immutableKeys) result[key] = item[key];
    return result;
  });
};

/**
 * Adds/updates the buyer's bap_terms.accept_bpp_terms=Y tag, which
 * validateConfirmPayload requires on every /confirm order (contract:
 * requireAcceptance in confirm-validation.ts). De-dupes by tag `code` so a
 * repeated call doesn't produce two `bap_terms` entries.
 */
export const withBapAcceptance = (tags: unknown) => {
  const list = Array.isArray(tags)
    ? tags.map((x: any) => ({
        ...x,
        list: Array.isArray(x?.list) ? [...x.list] : [],
      }))
    : [];
  const existing = list.find((x: any) => x.code === "bap_terms");
  if (existing) {
    existing.list = existing.list.filter(
      (x: any) => x.code !== "accept_bpp_terms",
    );
    existing.list.push({ code: "accept_bpp_terms", value: "Y" });
  } else
    list.push({
      code: "bap_terms",
      list: [{ code: "accept_bpp_terms", value: "Y" }],
    });
  return list;
};

/**
 * Merges the /init order with the /on_init callback order into the
 * authoritative "initialized" order used to build /confirm.
 *
 * /on_init is treated as authoritative where it provides a value (it may
 * refine pricing/quote/state), but /on_init is allowed to omit fields that
 * were present in /init (e.g. items[].category_id) — in that case the /init
 * value is retained rather than lost.
 */
/**
 * buildOndcInitOrder (init-persistence.mapper.ts) returns `billing: {}` and
 * `payment: {}` — an empty-but-present object, not an omitted key — when a
 * snapshot has no billing/payment rows. That's always true for /on_init
 * (the contract never carries billing there), so a blind `{...a, ...b}`
 * spread would silently clobber /init's real billing with an empty object.
 * Treat an empty object the same as "field not supplied by /on_init".
 */
const isEmptyObject = (value: unknown) =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.keys(value).length === 0;

const preferNonEmpty = <T>(onInitValue: T | undefined, initValue: T): T =>
  onInitValue !== undefined && !isEmptyObject(onInitValue) ? onInitValue : initValue;

export const mergeInitializedOrder = (
  initOrder: OndcInitOrder,
  onInitOrder: OndcInitOrder | undefined,
): OndcInitOrder => {
  const merged = {
    ...initOrder,
    ...onInitOrder,
    provider: {
      ...initOrder.provider,
      ...onInitOrder?.provider,
      // /on_init may omit provider.locations even when /init sent them.
      locations: onInitOrder?.provider?.locations ?? initOrder.provider.locations,
    },
    // /on_init never carries billing per the contract, and /on_init may not
    // echo payment either — fall back to /init's values rather than the
    // empty object buildOndcInitOrder returns for a missing snapshot field.
    billing: preferNonEmpty(onInitOrder?.billing, initOrder.billing),
    payment: preferNonEmpty(onInitOrder?.payment, initOrder.payment),
    items: mergeById(initOrder.items, onInitOrder?.items, []),
    fulfillments: mergeById(initOrder.fulfillments, onInitOrder?.fulfillments, []),
  } as OndcInitOrder;

  console.log("[confirm.mapper] merged /init + /on_init order", {
    itemCount: merged.items?.length,
    fulfillmentCount: merged.fulfillments?.length,
    onInitOverrodeLocations: Boolean(onInitOrder?.provider?.locations),
    usedInitBilling: isEmptyObject(onInitOrder?.billing) || onInitOrder?.billing === undefined,
    usedInitPayment: isEmptyObject(onInitOrder?.payment) || onInitOrder?.payment === undefined,
  });

  return merged;
};

/**
 * Folds confirm-time-only fulfillment fields (@ondc/org/awb_no, start.time,
 * start/end.instructions, fulfillment tags such as
 * state/rto_action/reverseqc_input) from the caller's supplied order onto
 * the initialized fulfillment.
 *
 * These fields are NOT part of the /init or /on_init fulfillment shape per
 * the contract (init only carries location + contact) — they only exist
 * from /confirm onward, so they must come from the caller's /confirm
 * request rather than the initialized transaction. `location` and
 * `contact` stay authoritative from /init and are never overwritten here.
 *
 * `person` is deliberately excluded from this merge: start/end.person.name
 * always comes from the initialized transaction (which sources it from the
 * originating /search request's location address name — see
 * extractInitOrder's personNameOverride), never from the caller, so a
 * /confirm request never needs to (and can no longer) supply it.
 */
const mergeConfirmFulfillments = (
  initializedFulfillments: OndcInitFulfillment[],
  suppliedFulfillments: unknown,
): OndcInitFulfillment[] => {
  const supplied = Array.isArray(suppliedFulfillments) ? suppliedFulfillments : [];
  return initializedFulfillments.map((fulfillment) => {
    const match = supplied.find((candidate: any) => candidate?.id === fulfillment.id) as
      | any
      | undefined;
    if (!match) return fulfillment;

    const merged: OndcInitFulfillment = {
      ...fulfillment,
      ...(match["@ondc/org/awb_no"]
        ? { "@ondc/org/awb_no": match["@ondc/org/awb_no"] }
        : {}),
      start: {
        ...fulfillment.start,
        ...(match.start?.time ? { time: match.start.time } : {}),
        ...(match.start?.instructions
          ? { instructions: match.start.instructions }
          : {}),
      },
      end: {
        ...fulfillment.end,
        ...(match.end?.instructions ? { instructions: match.end.instructions } : {}),
      },
      ...(Array.isArray(match.tags) ? { tags: match.tags } : {}),
    };
    return merged;
  });
};

/**
 * Merges order-level tags by `code`: `base` (initialized, e.g. bpp_terms
 * echoed from /on_init) is kept, and any `overlay` (caller-supplied) entry
 * with the same code replaces it, otherwise is added. This is deliberately
 * a merge and not a replace — the /confirm contract sample carries both
 * bpp_terms (from /on_init) and bap_terms (buyer acceptance) together, so a
 * caller supplying only bap_terms must not wipe out bpp_terms.
 */
const mergeTagsByCode = (
  base: unknown,
  overlay: unknown,
): Array<{ code: string; list?: Array<{ code: string; value: string }> }> => {
  const byCode = new Map<string, any>();
  for (const tag of Array.isArray(base) ? base : []) byCode.set(tag?.code, tag);
  for (const tag of Array.isArray(overlay) ? overlay : []) byCode.set(tag?.code, tag);
  return Array.from(byCode.values());
};

export interface BuildConfirmOrderInput {
  initialized: OndcInitOrder;
  suppliedOrder: Record<string, any>;
  orderId: string;
  now: string;
}

/**
 * Builds the final OndcConfirmOrder sent to the LSP. `initialized` (from
 * /init + /on_init) is authoritative for identity/pricing fields
 * (provider, items, quote, billing, payment); `suppliedOrder` supplies the
 * confirm-only fields the contract introduces at this step
 * (@ondc/org/linked_order, and per-fulfillment person/time/instructions/tags).
 */
export const buildConfirmOrder = ({
  initialized,
  suppliedOrder,
  orderId,
  now,
}: BuildConfirmOrderInput): OndcConfirmOrder => {
  const order: OndcConfirmOrder = {
    ...initialized,
    ...suppliedOrder,
    id: orderId,
    state: "Created",
    created_at: suppliedOrder.created_at ?? initialized.created_at ?? now,
    updated_at: now,
    provider: initialized.provider,
    items: initialized.items,
    fulfillments: mergeConfirmFulfillments(
      initialized.fulfillments,
      suppliedOrder.fulfillments,
    ),
    quote: initialized.quote as Record<string, unknown>,
    billing: initialized.billing,
    payment: initialized.payment,
    // Unlike billing/payment/quote, linked_order never appears in /init or
    // /on_init per the contract — it is only ever supplied at /confirm.
    "@ondc/org/linked_order": suppliedOrder["@ondc/org/linked_order"],
    tags: withBapAcceptance(mergeTagsByCode(initialized.tags, suppliedOrder.tags)),
  } as OndcConfirmOrder;

  console.log("[confirm.mapper] built /confirm order", {
    orderId: order.id,
    fulfillmentIds: order.fulfillments?.map((f) => f.id),
    hasLinkedOrder: Boolean(order["@ondc/org/linked_order"]),
  });

  return order;
};

export interface BuildConfirmPayloadInput {
  order: OndcConfirmOrder;
  initContext: OndcContext & { bpp_id?: string; bpp_uri?: string };
  transactionId: string;
  messageId: string;
  now: string;
}

/** Builds the full /confirm request envelope (context + message.order). */
export const buildConfirmPayload = ({
  order,
  initContext,
  transactionId,
  messageId,
  now,
}: BuildConfirmPayloadInput): OndcConfirmRequest => {
  const payload: OndcConfirmRequest = {
    // Same base + LSP as the /init this confirms; new message_id.
    context: buildRequestContext("confirm", {
      base: initContext,
      bppId: initContext.bpp_id,
      bppUri: initContext.bpp_uri,
      transactionId,
      messageId,
      timestamp: now,
      ttl: initContext.ttl,
    }) as OndcConfirmRequest["context"],
    message: { order },
  };

  console.log("[confirm.mapper] built /confirm payload", {
    transactionId: payload.context.transaction_id,
    messageId: payload.context.message_id,
    orderId: payload.message.order.id,
  });

  return payload;
};
