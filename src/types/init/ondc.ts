import type { OndcContext, OndcFulfillmentLocation, OndcPayloadDetails } from "../search/ondc.js";

export interface OndcInitProvider { id: string; locations: Array<{ id: string }>; }
export interface OndcInitItem { id: string; fulfillment_id?: string; category_id?: string; descriptor?: { code?: string; name?: string; short_desc?: string; long_desc?: string }; time?: { label?: string; duration?: string; timestamp?: string }; }
export interface OndcInitContact { phone?: string; email?: string; }
export interface OndcInitFulfillmentSide extends OndcFulfillmentLocation { time?: { duration?: string; timestamp?: string }; person?: { name?: string }; contact?: OndcInitContact; }
export interface OndcInitFulfillment { id: string; type: string; start: OndcInitFulfillmentSide; end: OndcInitFulfillmentSide; tags?: Array<{ code: string; list?: Array<{ code: string; value: string }> }>; }
export interface OndcInitOrder { provider: OndcInitProvider; items: OndcInitItem[]; fulfillments: OndcInitFulfillment[]; billing: Record<string, unknown>; payment: Record<string, unknown>; quote?: Record<string, unknown>; cancellation_terms?: Record<string, unknown>[]; tags?: Array<{ code: string; list?: Array<{ code: string; value: string }> }>; "@ondc/org/payload_details"?: OndcPayloadDetails; "@ondc/org/linked_order"?: Record<string, unknown>; created_at?: string; updated_at?: string; }
export interface OndcInitRequest { context: OndcContext & { action: "init"; bpp_id: string; bpp_uri: string }; message: { order: OndcInitOrder }; }
export interface OndcOnInitResponse { context: OndcContext & { action: "on_init"; transaction_id: string }; message?: { order?: OndcInitOrder }; error?: Record<string, unknown>; }
