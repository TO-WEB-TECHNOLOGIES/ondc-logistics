import type { OndcConfirmOrder } from "./ondc.js";

/**
 * Public API DTO. Deliberately minimal — provider/items/quote/billing/
 * payment are never supplied by the caller; they always come from the
 * stored /init + /on_init transaction (see confirm.service.ts's
 * loadInitialized). `linkedOrder` and `fulfillments` are the confirm-only
 * fields this NP actually needs to pass through (maps to
 * @ondc/org/linked_order and per-fulfillment confirm-only fields — see
 * confirm.mapper.ts's toSuppliedOrder/mergeConfirmFulfillments). The ONDC
 * payload itself is generated separately by ConfirmService.
 */
export interface ConfirmRequest {
  initTransactionId: string;
  linkedOrder?: Record<string, unknown>;
  fulfillments?: Array<Record<string, unknown>>;
}

export type GeneratedConfirmOrder = OndcConfirmOrder;

export interface ConfirmResponse {
  orderId: string;
  transactionId: string;
  messageId: string;
  status: "CONFIRM_SENT";
}
