/**
 * ONDC IGM Issue Category Definitions
 *
 * Maps BAP-internal category codes (used by frontend dropdown) to ONDC protocol
 * descriptor codes (used in network transport).
 *
 * Source of truth: IGM 2.0 Features & Functionalities CSV — Retail category codes.
 * Reference: ONDC Issue Category Codes from API Contract for Retail v1.2.0
 *
 * Frontend workflow:
 *   1. User selects a category from the dropdown → gets categoryCode + shortDesc
 *   2. Frontend sends categoryCode to BFF
 *   3. BFF maps categoryCode → descriptorCode for ONDC network
 *
 * Changelog:
 *   2026-05-26 — Restricted to spec-only IGM 2.0 categories:
 *     - Removed DELIVERY_REFUSED (DRP002), NOT_DELIVERED (DRP003), CANCEL_REFUSED (CNR002),
 *       BILLING_ISSUE (BLL001), ORDER_NOT_FOUND (ORD001 wrong semantics), OTHER (GEN001)
 *       — none of these descriptor code prefixes exist in the IGM 2.0 spec CSV.
 *     - CANCEL_NO_RESPONSE (CNR001) retained: used by force-cancel auto-escalation in
 *       cancel.controller.ts and is not a user-facing dropdown option.
 *   2026-05-26 — Full ITM001–ITM006 + FLM005 + ORD003 coverage per IGM 2.0 spec CSV:
 *     - ITEM_MISSING fixed: ITM006 → ITM001 (was "Incorrectly marked as returned")
 *     - WRONG_ITEM fixed:   ITM005 → ITM003 (was "Expired item")
 *     - Added ITEM_QUANTITY (ITM002), ITEM_EXPIRED (ITM005), ITEM_WRONGLY_RETURNED (ITM006)
 *     - Added PACKAGING_ISSUE (FLM005 — Spillage/improper packaging)
 *     - Added requiresImages flag: mandatory for ITM002–ITM005 and FLM005
 *     - DELIVERY_DELAY fixed: DRP001 → ORD003 (DRP001 is not in spec)
 */

/** BAP-internal category code — used in frontend dropdown and API requests */
export type IssueCategoryCode =
  // ── ITEM issues (ITM) — all sourced from IGM 2.0 spec CSV ──────────────────
  | "ITEM_MISSING" // ITM001 — Item(s) not present in delivery
  | "ITEM_QUANTITY" // ITM002 — Quantity less than ordered (images required)
  | "WRONG_ITEM" // ITM003 — Item mismatch / wrong variant (images required)
  | "ITEM_QUALITY" // ITM004 — Stale/damaged/poor-quality item (images required)
  | "ITEM_EXPIRED" // ITM005 — Item delivered beyond expiry date (images required)
  | "ITEM_WRONGLY_RETURNED" // ITM006 — Marked as returned but never picked up
  // ── Fulfillment issues (FLM) ────────────────────────────────────────────────
  | "PACKAGING_ISSUE" // FLM005 — Spillage / improper packaging (images required)
  // ── Order issues (ORD) ──────────────────────────────────────────────────────
  | "DELIVERY_DELAY" // ORD003 — Order delivered late
  // ── Internal-only (not in user-facing dropdown) ─────────────────────────────
  | "CANCEL_NO_RESPONSE"; // CNR001 — Auto-raised by force-cancel flow only

export interface IssueCategory {
  /** BAP-internal code — frontend uses this in API requests */
  categoryCode: IssueCategoryCode;
  /** ONDC protocol descriptor code — sent to BPP in /issue payload */
  descriptorCode: string;
  /** Human-readable short description for frontend dropdown */
  shortDesc: string;
  /** Long description shown to user before submitting */
  longDesc: string;
  /** Which ONDC ref_types are relevant for this category */
  applicableRefs: ("ORDER" | "PROVIDER" | "FULFILLMENT" | "ITEM")[];
  /** Whether this category supports resolution options (REFUND, REPLACEMENT) */
  supportsResolutions: boolean;
  /**
   * When true, images[] are mandatory on complaint creation.
   * Applies to ITM002–ITM005 and FLM005 per IGM 2.0 spec (photo evidence required for
   * quantity, mismatch, quality, expiry, and packaging disputes).
   */
  requiresImages?: boolean;
  /**
   * When true, this category is used internally by the system (e.g. force-cancel auto-raise)
   * and should NOT appear in the user-facing dropdown.
   */
  internalOnly?: boolean;
}

/**
 * All supported issue categories.
 * Frontend dropdown: filter to entries where internalOnly is not true.
 */
export const ISSUE_CATEGORIES: Record<IssueCategoryCode, IssueCategory> = {
  // ─── ITEM issues (ITM) ────────────────────────────────────────────────────

  ITEM_MISSING: {
    categoryCode: "ITEM_MISSING",
    descriptorCode: "ITM001",
    shortDesc: "Missing items",
    longDesc:
      "One or more items that were ordered are not present in the delivery.",
    applicableRefs: ["ORDER", "ITEM"],
    supportsResolutions: true,
  },

  ITEM_QUANTITY: {
    categoryCode: "ITEM_QUANTITY",
    descriptorCode: "ITM002",
    shortDesc: "Quantity issue",
    longDesc:
      "The quantity delivered is less than what was ordered (e.g. ordered 5 units, received 3).",
    applicableRefs: ["ORDER", "ITEM"],
    supportsResolutions: true,
    // IGM 2.0 spec requires photo evidence for quantity disputes.
    requiresImages: true,
  },

  WRONG_ITEM: {
    categoryCode: "WRONG_ITEM",
    descriptorCode: "ITM003",
    shortDesc: "Item mismatch",
    longDesc:
      "A different item was delivered than what was ordered (e.g. wrong size, colour, variant, or product).",
    applicableRefs: ["ORDER", "ITEM"],
    supportsResolutions: true,
    // IGM 2.0 spec requires photo evidence for mismatch disputes.
    requiresImages: true,
  },

  ITEM_QUALITY: {
    categoryCode: "ITEM_QUALITY",
    descriptorCode: "ITM004",
    shortDesc: "Quality issue",
    longDesc:
      "Item was stale, rotten, damaged, had missing parts (e.g. buttons), or was of unacceptable quality.",
    applicableRefs: ["ORDER", "ITEM"],
    supportsResolutions: true,
    // IGM 2.0 spec requires photo evidence for quality disputes.
    requiresImages: true,
  },

  ITEM_EXPIRED: {
    categoryCode: "ITEM_EXPIRED",
    descriptorCode: "ITM005",
    shortDesc: "Expired item",
    longDesc: "The product was delivered beyond its date of expiry.",
    applicableRefs: ["ORDER", "ITEM"],
    supportsResolutions: true,
    // IGM 2.0 spec requires photo evidence for expiry disputes.
    requiresImages: true,
  },

  ITEM_WRONGLY_RETURNED: {
    categoryCode: "ITEM_WRONGLY_RETURNED",
    descriptorCode: "ITM006",
    shortDesc: "Incorrectly marked as returned",
    longDesc:
      "The product was to be picked up or returned to the seller but was never actually collected.",
    applicableRefs: ["ORDER", "ITEM"],
    supportsResolutions: true,
  },

  // ─── Fulfillment / Packaging issues (FLM) ────────────────────────────────

  PACKAGING_ISSUE: {
    categoryCode: "PACKAGING_ISSUE",
    descriptorCode: "FLM005",
    shortDesc: "Packaging issue",
    longDesc: "The order arrived with spillage or improper/damaged packaging.",
    applicableRefs: ["ORDER", "FULFILLMENT"],
    supportsResolutions: true,
    // IGM 2.0 spec requires photo evidence for packaging disputes.
    requiresImages: true,
  },

  // ─── Order issues (ORD) ───────────────────────────────────────────────────

  DELIVERY_DELAY: {
    categoryCode: "DELIVERY_DELAY",
    descriptorCode: "ORD003",
    shortDesc: "Delayed delivery",
    longDesc: "The order was delivered later than the promised delivery time.",
    applicableRefs: ["ORDER", "FULFILLMENT"],
    supportsResolutions: true,
  },

  // ─── Internal-only (not shown in user-facing dropdown) ───────────────────

  CANCEL_NO_RESPONSE: {
    categoryCode: "CANCEL_NO_RESPONSE",
    descriptorCode: "CNR001",
    shortDesc: "Seller not responding to cancellation",
    longDesc: "I requested cancellation but the seller is not responding.",
    applicableRefs: ["ORDER"],
    supportsResolutions: false,
    // Not a spec code — retained solely for force-cancel auto-escalation in cancel.controller.ts.
    internalOnly: true,
  },
};

/**
 * Maps a BAP categoryCode to its ONDC descriptorCode.
 */
export function getDescriptorCode(categoryCode: IssueCategoryCode): string {
  return ISSUE_CATEGORIES[categoryCode]?.descriptorCode ?? "";
}

/**
 * Returns category options for the frontend dropdown (excludes internalOnly entries).
 * Usage: ISSUE_CATEGORY_OPTIONS.map(opt => ({ value: opt.categoryCode, label: opt.shortDesc }))
 */
export const ISSUE_CATEGORY_OPTIONS = Object.values(ISSUE_CATEGORIES).filter(
  (c) => !c.internalOnly,
);
