/**
 * App-level /update request types.
 *
 * `UpdateType` is an app-specific enum, NOT an ONDC contract enum — the
 * contract (docs/ondc/ondc logistics.docx, "/update" section) only ever
 * uses a single `update_target: "fulfillment"` value; it does not define
 * per-field update-type enums. This enum exists purely to let the frontend
 * tell our API which fields it wants changed, and is never forwarded to
 * ONDC (see mappers/update/index.ts).
 */
export type UpdateType =
  | "LINKED_ORDER_DETAILS"
  | "START_INSTRUCTION"
  | "END_INSTRUCTION"
  | "START_AUTHENTICATION"
  | "END_AUTHENTICATION"
  | "READY_TO_SHIP";

interface UpdateRequestBase {
  /** logistics_order.order_id */
  orderId: string;
  /**
   * Identifies which fulfillment row this update targets. logistics_order
   * stores a single fulfillment per order (see logistics-order.schema.ts),
   * so this is checked against the stored fulfillment_id as a safeguard —
   * it does not select among multiple fulfillments.
   */
  fulfillmentId: string;
  context?: { transaction_id?: string; message_id?: string };
}

export interface LinkedOrderDetailsUpdateRequest extends UpdateRequestBase {
  updateType: "LINKED_ORDER_DETAILS";
  linkedOrder: {
    retailOrderId?: string;
    productName?: string;
    quantityCount?: number;
    weight?: { unit: string; value: string | number };
    dimensions?: {
      length?: { unit: string; value: string | number };
      breadth?: { unit: string; value: string | number };
      height?: { unit: string; value: string | number };
    };
    providerName?: string;
  };
}

/** Covers both PCC (start) and DCC (end) instructions — same shape either side. */
export interface InstructionUpdateRequest extends UpdateRequestBase {
  updateType: "START_INSTRUCTION" | "END_INSTRUCTION";
  instruction: {
    code: string;
    shortDesc?: string;
    longDesc?: string;
    images?: string[];
  };
}

/** OTP (or other) authorization for pickup (start) or delivery (end). */
export interface AuthenticationUpdateRequest extends UpdateRequestBase {
  updateType: "START_AUTHENTICATION" | "END_AUTHENTICATION";
  authorization: {
    /** Defaults to "OTP" if omitted. */
    type?: string;
    token: string;
    validFrom?: string;
    validTo?: string;
  };
}

/** Marks the fulfillment ready to ship (order.fulfillments[].tags state=ready_to_ship). */
export interface ReadyToShipUpdateRequest extends UpdateRequestBase {
  updateType: "READY_TO_SHIP";
}

export type UpdateRequest =
  | LinkedOrderDetailsUpdateRequest
  | InstructionUpdateRequest
  | AuthenticationUpdateRequest
  | ReadyToShipUpdateRequest;

export interface UpdateResponse {
  orderId: string;
  transactionId: string;
  messageId: string;
  updateType: UpdateType;
  status: "UPDATE_SENT";
}
