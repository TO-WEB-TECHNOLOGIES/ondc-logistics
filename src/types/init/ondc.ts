import type { OndcContext, OndcFulfillmentLocation, OndcPayloadDetails } from "../search/ondc.js";

export interface OndcInitProvider { id: string; locations: Array<{ id: string }>; }
export interface OndcInitItem { id: string; fulfillment_id?: string; category_id?: string; descriptor?: { code?: string; name?: string; short_desc?: string; long_desc?: string }; time?: { label?: string; duration?: string; timestamp?: string }; }
export interface OndcInitContact { phone?: string; email?: string; }
export interface OndcInitInstruction { code?: string; short_desc?: string; long_desc?: string; images?: string[]; additional_desc?: { content_type?: string; url?: string }; }
export interface OndcInitFulfillmentTime { duration?: string; timestamp?: string; range?: { start?: string; end?: string }; }
export interface OndcInitFulfillmentSide extends OndcFulfillmentLocation { time?: OndcInitFulfillmentTime; person?: { name?: string }; contact?: OndcInitContact; instructions?: OndcInitInstruction; }
export interface OndcInitFulfillment { id: string; type: string; start: OndcInitFulfillmentSide; end: OndcInitFulfillmentSide; state?: { descriptor?: { code?: string; short_desc?: string } }; "@ondc/org/awb_no"?: string; tracking?: boolean; agent?: Record<string, unknown>; vehicle?: Record<string, unknown>; tags?: Array<{ code: string; list?: Array<{ code: string; value: string }> }>; }
export interface OndcInitOrder { provider: OndcInitProvider; items: OndcInitItem[]; fulfillments: OndcInitFulfillment[]; billing: Record<string, unknown>; payment: Record<string, unknown>; quote?: Record<string, unknown>; cancellation_terms?: Record<string, unknown>[]; tags?: Array<{ code: string; list?: Array<{ code: string; value: string }> }>; "@ondc/org/payload_details"?: OndcPayloadDetails; "@ondc/org/linked_order"?: Record<string, unknown>; created_at?: string; updated_at?: string; }
export interface OndcInitRequest { context: OndcContext & { action: "init"; bpp_id: string; bpp_uri: string }; message: { order: OndcInitOrder }; }
export interface OndcOnInitResponse { context: OndcContext & { action: "on_init"; transaction_id: string }; message?: { order?: OndcInitOrder }; error?: Record<string, unknown>; }
