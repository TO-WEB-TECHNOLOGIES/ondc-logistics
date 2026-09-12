import type { OndcContext } from "../search/ondc.js";

/**
 * ONDC wire shape for /cancel — per docs/ondc/ondc logistics.docx, "/cancel"
 * section, the request message is just `{ order_id, cancellation_reason_id }`.
 */
export interface OndcCancelRequest {
  context: OndcContext & {
    action: "cancel";
    bpp_id: string;
    bpp_uri: string;
    ttl?: string;
  };
  message: { order_id: string; cancellation_reason_id: string };
}

/**
 * /on_cancel carries the full order object (same shape family as
 * /on_confirm/on_status/on_update) — id, state, cancellation (cancelled_by +
 * reason.id), provider, items, quote, fulfillments (incl. the RTO flow's
 * extra RTO fulfillment/item + rto_event tag), payment, billing, linked_order,
 * tags. Per docs/ondc/ondc logistics.docx, "/on_cancel" (and RTO flow) sections,
 * this callback can be solicited (reply to our /cancel) or unsolicited (LSP
 * cancels directly) — the shape is identical either way.
 */
export interface OndcOnCancelResponse {
  context: OndcContext & { action: "on_cancel"; transaction_id: string };
  message?: { order?: Record<string, unknown> };
  error?: Record<string, unknown>;
}
