import type { OndcContext } from "../search/ondc.js";
import type { OndcInitOrder } from "../init/ondc.js";

export interface OndcConfirmOrder extends OndcInitOrder {
  id: string;
  state: string;
  created_at?: string;
  updated_at?: string;
  quote: Record<string, unknown>;
  "@ondc/org/linked_order"?: Record<string, unknown>;
}

export interface OndcConfirmRequest {
  context: OndcContext & { action: "confirm"; bpp_id: string; bpp_uri: string };
  message: { order: OndcConfirmOrder };
}

export interface OndcOnConfirmResponse {
  context: OndcContext & { action: "on_confirm"; transaction_id: string };
  message?: { order?: OndcConfirmOrder };
  error?: Record<string, unknown>;
}
