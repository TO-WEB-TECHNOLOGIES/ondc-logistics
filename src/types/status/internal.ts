export interface StatusRequest {
  /** logistics_order.order_id */
  orderId: string;
  context?: { transaction_id?: string; message_id?: string };
}

export interface StatusResponse {
  orderId: string;
  transactionId: string;
  messageId: string;
  status: "STATUS_SENT";
}
