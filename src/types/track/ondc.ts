import type { OndcContext, OndcTag } from "../search/ondc.js";

/**
 * ONDC wire shape for /track — per docs/ondc/ondc logistics.docx, "/track"
 * section, the request message is just `{ order_id }`, same shape as
 * /status.
 */
export interface OndcTrackRequest {
  context: OndcContext & {
    action: "track";
    bpp_id: string;
    bpp_uri: string;
    ttl?: string;
  };
  message: { order_id: string };
}

export interface OndcTrackingInfo {
  id?: string; // fulfillment id, e.g. "F1"
  url?: string;
  location?: {
    gps?: string;
    time?: { timestamp?: string };
    updated_at?: string;
  };
  status?: string; // "active" | "inactive" (not formally enumerated in the contract)
  tags?: OndcTag[]; // incl. code="path" breadcrumb entries, code="config", code="order"
}

/**
 * /on_track is always solicited (per contract N.B.) — carries the tracking
 * snapshot for the fulfillment, not a full order object like /on_status.
 */
export interface OndcOnTrackResponse {
  context: OndcContext & { action: "on_track"; transaction_id: string };
  message?: { tracking?: OndcTrackingInfo };
  error?: Record<string, unknown>;
}
