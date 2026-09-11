import type { OndcContext } from "../search/ondc.js";

/**
 * ONDC wire shape for /status — per docs/ondc/ondc logistics.docx, "/status"
 * section, the request message is just `{ order_id }`, unlike /update's
 * nested order object.
 */
export interface OndcStatusRequest {
  context: OndcContext & {
    action: "status";
    bpp_id: string;
    bpp_uri: string;
    ttl?: string;
  };
  message: { order_id: string };
}

/**
 * /on_status carries the full order object (same shape family as
 * /on_confirm//on_update) — id, state, cancellation, provider, items,
 * quote, fulfillments (state/awb/instructions/authorization/agent/vehicle/
 * ewaybill/tags), payment, billing, linked_order, tags.
 */
export interface OndcOnStatusResponse {
  context: OndcContext & { action: "on_status"; transaction_id: string };
  message?: { order?: Record<string, unknown> };
  error?: Record<string, unknown>;
}
