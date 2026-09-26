/**
 * Mapper for /cancel.
 *
 * Contract reference: docs/ondc/ondc logistics.docx, "/cancel" section —
 * the request is minimal, same shape family as /status: just
 * `message: { order_id, cancellation_reason_id }`, no nested order object.
 */
import type { OndcContext } from "../types/search/ondc.js";
import type { OndcCancelRequest } from "../types/cancel/ondc.js";
import type { CancellationReasonCode } from "../constants/cancellation-reason-codes.js";

export interface BuildCancelPayloadInput {
  orderId: string;
  cancellationReasonId: CancellationReasonCode;
  context: Pick<
    OndcContext,
    "domain" | "country" | "city" | "core_version" | "bap_id" | "bap_uri"
  >;
  bppId: string;
  bppUri: string;
  transactionId: string;
  messageId: string;
  now: string;
}

export const buildCancelPayload = ({
  orderId,
  cancellationReasonId,
  context,
  bppId,
  bppUri,
  transactionId,
  messageId,
  now,
}: BuildCancelPayloadInput): OndcCancelRequest => ({
  context: {
    ...context,
    action: "cancel",
    bpp_id: bppId,
    bpp_uri: bppUri,
    transaction_id: transactionId,
    message_id: messageId,
    timestamp: now,
    ttl: "PT30S",
  },
  message: { order_id: orderId, cancellation_reason_id: cancellationReasonId },
});
