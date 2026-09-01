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

export type CancellationReasonWho =
  "BNP" | "SNP" | "LSP" | "SNP_OFFLINE_LOGISTICS";

export interface CancellationReasonEntry {
  /** Current ONDC numbering, if this reason has one (some legacy-only codes don't). */
  newCode?: string;
  /** Legacy ONDC numbering, if this reason has one (some new-only codes don't). */
  currentCode?: string;
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
    currentCode: "001",
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
    newCode: "002",
    currentCode: "002",
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
    newCode: "021",
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
    newCode: "022",
    reason: "Technical issue in merchant device",
    whoCanUse: "SNP",
    costAttributionTo: "SNP",
    comment:
      "SNP accepted order as auto-acceptance enabled for the store; however, due to technical issue with merchant device at the store, order isn't getting relayed to the store",
    statesWhereApplicable: "Pending",
  },
  {
    newCode: "023",
    reason: "Order received during non-operational hours",
    whoCanUse: "SNP",
    costAttributionTo: "BNP",
    comment:
      "SNP receives order when store is closed, either temporarily or beyond normal operating hours",
    statesWhereApplicable: "Pending",
  },
  {
    newCode: "024",
    reason: "Order received during store rush",
    whoCanUse: "SNP",
    costAttributionTo: "SNP",
    comment:
      "SNP receives order during store rush, i.e. kitchen full or manpower shortage",
    statesWhereApplicable: "Pending",
  },
  {
    currentCode: "003",
    reason: "Product available at lower than order price",
    whoCanUse: "BNP",
    costAttributionTo: "SNP",
    statesWhereApplicable:
      "Pending, Packed, Agent-assigned (P2P); Out-for-pickup (P2H2P)",
  },
  {
    newCode: "051",
    currentCode: "004",
    reason: "Store is not accepting order",
    whoCanUse: "BNP",
    costAttributionTo: "SNP",
    comment:
      "BNP cancels the order in case the order is in created state for too long and is not getting accepted at the provider level",
    statesWhereApplicable: "Pending",
  },
  {
    currentCode: "005",
    reason: "Store rejected the order",
    whoCanUse: "SNP",
    costAttributionTo: "SNP",
    comment: "can use code 021 / 022 / 023 / 024",
    statesWhereApplicable: "Pending",
  },
  {
    currentCode: "009",
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
    newCode: "011",
    currentCode: "011",
    reason: "Retail buyer not found / can't be contacted",
    whoCanUse: "SNP",
    costAttributionTo: "BNP",
    comment: "use for offline logistics",
    statesWhereApplicable: "At-delivery (P2P); Out-for-delivery (P2H2P)",
  },
  {
    currentCode: "012",
    reason: "Buyer does not want product any more",
    whoCanUse: "SNP_OFFLINE_LOGISTICS",
    costAttributionTo: "BNP",
    comment: "merged into 013",
  },
  {
    newCode: "013",
    currentCode: "013",
    reason: "Retail buyer can't / doesn't want to accept delivery",
    whoCanUse: "SNP",
    costAttributionTo: "BNP",
    comment: "use for offline logistics",
    statesWhereApplicable: "At-delivery (P2P); Out-for-delivery (P2H2P)",
  },
  {
    newCode: "014",
    currentCode: "014",
    reason: "Delivery address incorrect or not found",
    whoCanUse: "SNP",
    costAttributionTo: "BNP",
    comment: "use for offline logistics",
    statesWhereApplicable: "At-delivery (P2P); Out-for-delivery (P2H2P)",
  },
  {
    currentCode: "015",
    reason: "Buyer not available at location",
    whoCanUse: "SNP_OFFLINE_LOGISTICS",
    costAttributionTo: "BNP",
    comment: "merged into 013",
  },
  {
    newCode: "016",
    currentCode: "016",
    reason: "Force majeure (accident / strike / law & order situation, etc)",
    whoCanUse: "SNP",
    costAttributionTo: "SNP",
    comment: "use for offline logistics",
    statesWhereApplicable:
      "Order-picked-up (P2P); Order-picked-up, In-transit, At-destination-hub (P2H2P);",
  },
  {
    currentCode: "017",
    reason: "Order delivery delayed or not possible (vehicle issues, etc)",
    whoCanUse: "LSP",
    costAttributionTo: "LSP",
    statesWhereApplicable:
      "Order-picked-up (P2P); In-transit, At-destination-hub (P2H2P);",
  },
  {
    newCode: "018",
    currentCode: "018",
    reason: "Order not serviceable",
    whoCanUse: "SNP",
    costAttributionTo: "SNP",
    comment:
      "Order not serviceable due to logistics issue, e.g. delivery location not sericeable, lost order; use for offline logistics",
    statesWhereApplicable: "At-destination-hub, Out-for-delivery (P2H2P);",
  },
  {
    newCode: "052",
    currentCode: "006",
    reason: "Order / fulfillment not received as per O2D TAT",
    whoCanUse: "BNP",
    costAttributionTo: "SNP",
    statesWhereApplicable:
      "Order-picked-up, At-delivery (P2P); Order-picked-up, In-transit, At-destination-hub, Out-for-delivery, Delivery-failed (P2H2P);",
  },
  {
    newCode: "053",
    currentCode: "010",
    reason: "Buyer wants to modify address / other order details",
    whoCanUse: "BNP",
    costAttributionTo: "BNP",
    statesWhereApplicable: "any state prior to Order-delivered;",
  },
  {
    currentCode: "020",
    reason: "Order lost or damaged in transit",
    whoCanUse: "SNP_OFFLINE_LOGISTICS",
    costAttributionTo: "LSP",
    statesWhereApplicable:
      "Order-picked-up (P2P); Order-picked-up, In-transit, At-destination-hub, Out-for-delivery (P2H2P);",
  },
  {
    currentCode: "998",
    reason: "Order confirmation failure",
    whoCanUse: "SNP",
    costAttributionTo: "N/A",
    statesWhereApplicable: "Pending",
  },
  {
    currentCode: "999",
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
export const BNP_CANCELLATION_REASON_CODES: string[] =
  CANCELLATION_REASON_CODES.filter(
    (entry) => entry.whoCanUse === "BNP",
  ).flatMap((entry) =>
    [entry.newCode, entry.currentCode].filter((c): c is string => !!c),
  );

export function isValidBnpCancellationReason(code: string): boolean {
  return BNP_CANCELLATION_REASON_CODES.includes(code);
}
