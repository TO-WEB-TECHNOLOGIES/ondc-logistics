import type { CancellationReasonCode } from "../../constants/cancellation-reason-codes.js";

export interface CancelRequest {
  /** logistics_order.order_id */
  orderId: string;
  /** Must be one of BNP_CANCELLATION_REASON_CODES (constants/cancellation-reason-codes.ts). */
  cancellationReasonId: CancellationReasonCode;
  context?: { transaction_id?: string; message_id?: string };
}

export interface CancelResponse {
  orderId: string;
  transactionId: string;
  messageId: string;
  status: "CANCEL_SENT";
}
