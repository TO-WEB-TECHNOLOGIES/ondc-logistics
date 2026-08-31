import type { OndcConfirmOrder } from "./ondc.js";

export interface ConfirmOrderInput {
  id?: string;
  items?: Array<Record<string, unknown>>;
  provider?: Record<string, unknown>;
  fulfillments?: Array<Record<string, unknown>>;
  quote?: Record<string, unknown>;
  billing?: Record<string, unknown>;
  payment?: Record<string, unknown>;
  tags?: Array<Record<string, unknown>>;
  "@ondc/org/linked_order"?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Public API DTO. The ONDC payload is generated separately by ConfirmService. */
export interface ConfirmRequest {
  initTransactionId: string;
  context?: { transaction_id?: string; message_id?: string };
  message?: { order?: ConfirmOrderInput };
  order?: ConfirmOrderInput;
}

export type GeneratedConfirmOrder = OndcConfirmOrder;

export interface ConfirmResponse {
  orderId: string;
  transactionId: string;
  messageId: string;
  status: "CONFIRM_SENT";
}