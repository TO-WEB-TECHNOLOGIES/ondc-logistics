export interface TrackRequest {
  /** logistics_order.order_id */
  orderId: string;
  context?: { transaction_id?: string; message_id?: string };
}

export interface TrackResponse {
  orderId: string;
  transactionId: string;
  messageId: string;
  status: "TRACK_SENT";
}
