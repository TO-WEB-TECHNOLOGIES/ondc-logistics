/**
 * ONDC Retail Cancellation Reason Codes
 *
 * Source of truth: "Reason codes - Cancellation - Retail.csv" (ONDC Retail cancellation
 * reason code registry). ONDC re-numbered these codes at some point — the CSV's "Code (new)"
 * column is the current numbering, "Code (current)" is the legacy numbering some BPPs may
 * still send. Both are kept per entry and the lookup matches either, since which numbering
 * a given counterparty NP uses is not something this BAP controls.
 *
 * This project is a Buyer NP (BNP) for F&B (ONDC:RET11), BAP-collected prepaid, delivery
 * fulfillment only — CANCELLATION_REASON_CODES below covers the full retail registry (BNP,
 * SNP, and LSP reasons) so inbound /on_cancel from any counterparty can be identified and
 * described correctly; BNP_CANCELLATION_REASON_CODES is the subset this NP is actually
 * allowed to send in an outbound /cancel.
 */

/**
 * Every code (new + legacy numbering) in CANCELLATION_REASON_CODES below. Where a reason
 * was re-numbered, the legacy code carries a `_LEGACY` suffix.
 */
export enum CancellationReasonCode {
  ITEM_PRICE_CHANGED = "001",
  ITEMS_NOT_AVAILABLE = "002",
  PRODUCT_AVAILABLE_AT_LOWER_PRICE = "003",
  STORE_NOT_ACCEPTING_ORDER_LEGACY = "004",
  STORE_REJECTED_ORDER = "005",
  O2D_TAT_BREACHED_LEGACY = "006",
  WRONG_PRODUCT_DELIVERED = "009",
  BUYER_WANTS_TO_MODIFY_ORDER_LEGACY = "010",
  BUYER_NOT_FOUND = "011",
  BUYER_DOES_NOT_WANT_PRODUCT = "012",
  BUYER_REFUSED_DELIVERY = "013",
  DELIVERY_ADDRESS_INCORRECT = "014",
  BUYER_NOT_AVAILABLE_AT_LOCATION = "015",
  FORCE_MAJEURE = "016",
  DELIVERY_DELAYED_OR_NOT_POSSIBLE = "017",
  ORDER_NOT_SERVICEABLE = "018",
  ORDER_LOST_OR_DAMAGED_IN_TRANSIT = "020",
  STORE_NOT_RESPONSIVE = "021",
  MERCHANT_DEVICE_TECHNICAL_ISSUE = "022",
  ORDER_DURING_NON_OPERATIONAL_HOURS = "023",
  ORDER_DURING_STORE_RUSH = "024",
  STORE_NOT_ACCEPTING_ORDER = "051",
  O2D_TAT_BREACHED = "052",
  BUYER_WANTS_TO_MODIFY_ORDER = "053",
  SNP_ORDER_CONFIRMATION_FAILURE = "998",
  BNP_ORDER_CONFIRMATION_FAILURE = "999",
}

const ALL_CANCELLATION_REASON_CODES: ReadonlySet<string> = new Set(
  Object.values(CancellationReasonCode),
);

export function isCancellationReasonCode(
  code: string,
): code is CancellationReasonCode {
  return ALL_CANCELLATION_REASON_CODES.has(code);
}

export type CancellationReasonWho =
  "BNP" | "SNP" | "LSP" | "SNP_OFFLINE_LOGISTICS";

export interface CancellationReasonEntry {
  /** Current ONDC numbering, if this reason has one (some legacy-only codes don't). */
  newCode?: CancellationReasonCode;
  /** Legacy ONDC numbering, if this reason has one (some new-only codes don't). */
  currentCode?: CancellationReasonCode;
  phase?: "pre-pickup" | "post-pickup";
  reason: string;
  whoCanUse: CancellationReasonWho;
  costAttributionTo: string;
  comment?: string;
  statesWhereApplicable?: string;
  triggersRTO?: boolean;
  applicableForPartCancel?: boolean;
  settlementSuggestion?: string;
}

export const CANCELLATION_REASON_CODES: CancellationReasonEntry[] = [
  {
    currentCode: CancellationReasonCode.ITEM_PRICE_CHANGED,
    phase: "pre-pickup",
    reason:
      "Price of one or more items have changed due to which buyer was asked to make additional payment",
    whoCanUse: "BNP",
    costAttributionTo: "SNP",
    statesWhereApplicable:
      "Pending, Packed, Agent-assigned (P2P); Out-for-pickup (P2H2P)",
    triggersRTO: false,
  },
  {
    newCode: CancellationReasonCode.ITEMS_NOT_AVAILABLE,
    currentCode: CancellationReasonCode.ITEMS_NOT_AVAILABLE,
    reason: "One or more items in the order not available",
    whoCanUse: "SNP",
    costAttributionTo: "SNP",
    comment:
      "SNP accepted order that includes items not available, probably due to incorrect inventory information at their end",
    statesWhereApplicable: "Pending",
    applicableForPartCancel: true,
    settlementSuggestion:
      "1. if buyer isn't interested in part-fill for the order, BNP can cancel the order as per flow defined here; 2. settlement between BNP & SNP is basis the last updated quote for the order;",
  },
  {
    newCode: CancellationReasonCode.STORE_NOT_RESPONSIVE,
    reason: "Store not responsive",
    whoCanUse: "SNP",
    costAttributionTo: "SNP",
    comment:
      "SNP accepted order as auto-acceptance enabled for the store; however, the store is not accepting the order or is non-responsive",
    statesWhereApplicable: "Pending",
    triggersRTO: false,
    settlementSuggestion:
      "settlement between BNP & SNP is basis the last updated quote for the order;",
  },
  {
    newCode: CancellationReasonCode.MERCHANT_DEVICE_TECHNICAL_ISSUE,
    reason: "Technical issue in merchant device",
    whoCanUse: "SNP",
    costAttributionTo: "SNP",
    comment:
      "SNP accepted order as auto-acceptance enabled for the store; however, due to technical issue with merchant device at the store, order isn't getting relayed to the store",
    statesWhereApplicable: "Pending",
  },
  {
    newCode: CancellationReasonCode.ORDER_DURING_NON_OPERATIONAL_HOURS,
    reason: "Order received during non-operational hours",
    whoCanUse: "SNP",
    costAttributionTo: "BNP",
    comment:
      "SNP receives order when store is closed, either temporarily or beyond normal operating hours",
    statesWhereApplicable: "Pending",
  },
  {
    newCode: CancellationReasonCode.ORDER_DURING_STORE_RUSH,
    reason: "Order received during store rush",
    whoCanUse: "SNP",
    costAttributionTo: "SNP",
    comment:
      "SNP receives order during store rush, i.e. kitchen full or manpower shortage",
    statesWhereApplicable: "Pending",
  },
  {
    currentCode: CancellationReasonCode.PRODUCT_AVAILABLE_AT_LOWER_PRICE,
    reason: "Product available at lower than order price",
    whoCanUse: "BNP",
    costAttributionTo: "SNP",
    statesWhereApplicable:
      "Pending, Packed, Agent-assigned (P2P); Out-for-pickup (P2H2P)",
  },
  {
    newCode: CancellationReasonCode.STORE_NOT_ACCEPTING_ORDER,
    currentCode: CancellationReasonCode.STORE_NOT_ACCEPTING_ORDER_LEGACY,
    reason: "Store is not accepting order",
    whoCanUse: "BNP",
    costAttributionTo: "SNP",
    comment:
      "BNP cancels the order in case the order is in created state for too long and is not getting accepted at the provider level",
    statesWhereApplicable: "Pending",
  },
  {
    currentCode: CancellationReasonCode.STORE_REJECTED_ORDER,
    reason: "Store rejected the order",
    whoCanUse: "SNP",
    costAttributionTo: "SNP",
    comment: "can use code 021 / 022 / 023 / 024",
    statesWhereApplicable: "Pending",
  },
  {
    currentCode: CancellationReasonCode.WRONG_PRODUCT_DELIVERED,
    phase: "post-pickup",
    reason: "Wrong product delivered",
    whoCanUse: "BNP",
    costAttributionTo: "SNP",
    statesWhereApplicable: "At-delivery (P2P); Out-for-delivery (P2H2P)",
    triggersRTO: true,
    settlementSuggestion:
      "settlement between BNP & SNP is basis the last updated quote for the order;",
  },
  {
    newCode: CancellationReasonCode.BUYER_NOT_FOUND,
    currentCode: CancellationReasonCode.BUYER_NOT_FOUND,
    reason: "Retail buyer not found / can't be contacted",
    whoCanUse: "SNP",
    costAttributionTo: "BNP",
    comment: "use for offline logistics",
    statesWhereApplicable: "At-delivery (P2P); Out-for-delivery (P2H2P)",
  },
  {
    currentCode: CancellationReasonCode.BUYER_DOES_NOT_WANT_PRODUCT,
    reason: "Buyer does not want product any more",
    whoCanUse: "SNP_OFFLINE_LOGISTICS",
    costAttributionTo: "BNP",
    comment: "merged into 013",
  },
  {
    newCode: CancellationReasonCode.BUYER_REFUSED_DELIVERY,
    currentCode: CancellationReasonCode.BUYER_REFUSED_DELIVERY,
    reason: "Retail buyer can't / doesn't want to accept delivery",
    whoCanUse: "SNP",
    costAttributionTo: "BNP",
    comment: "use for offline logistics",
    statesWhereApplicable: "At-delivery (P2P); Out-for-delivery (P2H2P)",
  },
  {
    newCode: CancellationReasonCode.DELIVERY_ADDRESS_INCORRECT,
    currentCode: CancellationReasonCode.DELIVERY_ADDRESS_INCORRECT,
    reason: "Delivery address incorrect or not found",
    whoCanUse: "SNP",
    costAttributionTo: "BNP",
    comment: "use for offline logistics",
    statesWhereApplicable: "At-delivery (P2P); Out-for-delivery (P2H2P)",
  },
  {
    currentCode: CancellationReasonCode.BUYER_NOT_AVAILABLE_AT_LOCATION,
    reason: "Buyer not available at location",
    whoCanUse: "SNP_OFFLINE_LOGISTICS",
    costAttributionTo: "BNP",
    comment: "merged into 013",
  },
  {
    newCode: CancellationReasonCode.FORCE_MAJEURE,
    currentCode: CancellationReasonCode.FORCE_MAJEURE,
    reason: "Force majeure (accident / strike / law & order situation, etc)",
    whoCanUse: "SNP",
    costAttributionTo: "SNP",
    comment: "use for offline logistics",
    statesWhereApplicable:
      "Order-picked-up (P2P); Order-picked-up, In-transit, At-destination-hub (P2H2P);",
  },
  {
    currentCode: CancellationReasonCode.DELIVERY_DELAYED_OR_NOT_POSSIBLE,
    reason: "Order delivery delayed or not possible (vehicle issues, etc)",
    whoCanUse: "LSP",
    costAttributionTo: "LSP",
    statesWhereApplicable:
      "Order-picked-up (P2P); In-transit, At-destination-hub (P2H2P);",
  },
  {
    newCode: CancellationReasonCode.ORDER_NOT_SERVICEABLE,
    currentCode: CancellationReasonCode.ORDER_NOT_SERVICEABLE,
    reason: "Order not serviceable",
    whoCanUse: "SNP",
    costAttributionTo: "SNP",
    comment:
      "Order not serviceable due to logistics issue, e.g. delivery location not sericeable, lost order; use for offline logistics",
    statesWhereApplicable: "At-destination-hub, Out-for-delivery (P2H2P);",
  },
  {
    newCode: CancellationReasonCode.O2D_TAT_BREACHED,
    currentCode: CancellationReasonCode.O2D_TAT_BREACHED_LEGACY,
    reason: "Order / fulfillment not received as per O2D TAT",
    whoCanUse: "BNP",
    costAttributionTo: "SNP",
    statesWhereApplicable:
      "Order-picked-up, At-delivery (P2P); Order-picked-up, In-transit, At-destination-hub, Out-for-delivery, Delivery-failed (P2H2P);",
  },
  {
    newCode: CancellationReasonCode.BUYER_WANTS_TO_MODIFY_ORDER,
    currentCode: CancellationReasonCode.BUYER_WANTS_TO_MODIFY_ORDER_LEGACY,
    reason: "Buyer wants to modify address / other order details",
    whoCanUse: "BNP",
    costAttributionTo: "BNP",
    statesWhereApplicable: "any state prior to Order-delivered;",
  },
  {
    currentCode: CancellationReasonCode.ORDER_LOST_OR_DAMAGED_IN_TRANSIT,
    reason: "Order lost or damaged in transit",
    whoCanUse: "SNP_OFFLINE_LOGISTICS",
    costAttributionTo: "LSP",
    statesWhereApplicable:
      "Order-picked-up (P2P); Order-picked-up, In-transit, At-destination-hub, Out-for-delivery (P2H2P);",
  },
  {
    currentCode: CancellationReasonCode.SNP_ORDER_CONFIRMATION_FAILURE,
    reason: "Order confirmation failure",
    whoCanUse: "SNP",
    costAttributionTo: "N/A",
    statesWhereApplicable: "Pending",
  },
  {
    currentCode: CancellationReasonCode.BNP_ORDER_CONFIRMATION_FAILURE,
    reason: "Order confirmation failure",
    whoCanUse: "BNP",
    costAttributionTo: "N/A",
    statesWhereApplicable: "Pending",
  },
];

/** Looks up a reason entry by either its new or legacy (current) code. */
export function getCancellationReason(
  code: string | null | undefined,
): CancellationReasonEntry | undefined {
  if (!code) return undefined;
  return CANCELLATION_REASON_CODES.find(
    (entry) => entry.newCode === code || entry.currentCode === code,
  );
}

/** Human-readable reason text for a code — for SSE payloads and push notifications.
 * Falls back to a safe generic string when the code is unrecognized (e.g. a future
 * ONDC code this table hasn't been updated for yet) rather than surfacing raw codes
 * or nothing at all to the buyer. */
export function getCancellationReasonText(
  code: string | null | undefined,
): string {
  return getCancellationReason(code)?.reason ?? "Order cancelled";
}

/**
 * Every code (new + legacy) this NP is allowed to send as `cancellation_reason_id`
 * in an outbound /cancel — i.e. every entry whose `whoCanUse` is "BNP". Used by
 * cancel.service.ts's sendCancelRequest for request validation.
 *
 * NOTE: 002 ("item unavailable") and 005 ("store rejected the order") are SNP-only
 * per the registry — a previous version of this list incorrectly included them as
 * BAP-sendable legacy codes. Corrected here (CANCEL-01, 2026-07-13).
 */
export const BNP_CANCELLATION_REASON_CODES: CancellationReasonCode[] =
  CANCELLATION_REASON_CODES.filter(
    (entry) => entry.whoCanUse === "BNP",
  ).flatMap((entry) =>
    [entry.newCode, entry.currentCode].filter(
      (c): c is CancellationReasonCode => !!c,
    ),
  );

export function isValidBnpCancellationReason(
  code: string,
): code is CancellationReasonCode {
  return (
    isCancellationReasonCode(code) &&
    BNP_CANCELLATION_REASON_CODES.includes(code)
  );
}
