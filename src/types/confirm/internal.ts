export interface ConfirmRequest {
  initTransactionId: string;
  order?: Record<string, unknown>;
}

export interface ConfirmResponse {
  orderId: string;
  transactionId: string;
  messageId: string;
  status: "CONFIRM_SENT";
}
