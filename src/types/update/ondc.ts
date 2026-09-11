import type { OndcContext, OndcTag } from "../search/ondc.js";

/**
 * ONDC wire shape for /update's message.order — a minimal subset of the
 * full order (id, items identity, the touched fulfillment, and
 * @ondc/org/linked_order when relevant), per docs/ondc/ondc logistics.docx,
 * "/update" section. Not the same shape as OndcConfirmOrder: /update never
 * carries quote/billing/payment.
 */
export interface OndcUpdateOrder {
  id: string;
  items: Array<{
    id: string;
    category_id?: string;
    descriptor?: { code?: string };
  }>;
  fulfillments: Array<{
    id: string;
    type?: string;
    "@ondc/org/awb_no"?: string;
    start?: Record<string, unknown>;
    end?: Record<string, unknown>;
    tags?: OndcTag[];
  }>;
  "@ondc/org/linked_order"?: Record<string, unknown>;
  updated_at?: string;
}

export interface OndcUpdateRequest {
  context: OndcContext & {
    action: "update";
    bpp_id: string;
    bpp_uri: string;
    ttl?: string;
  };
  message: { update_target: "fulfillment"; order: OndcUpdateOrder };
}

export interface OndcOnUpdateResponse {
  context: OndcContext & { action: "on_update"; transaction_id: string };
  message?: { order?: Record<string, unknown> };
  error?: Record<string, unknown>;
}
