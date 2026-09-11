/**
 * Mapper for /status.
 *
 * Contract reference: docs/ondc/ondc logistics.docx, "/status" section —
 * the request is the simplest of any order-lifecycle API: just
 * `message: { order_id }`, no nested order object.
 */
import type { OndcContext } from "../types/search/ondc.js";
import type { OndcStatusRequest } from "../types/status/ondc.js";

export interface BuildStatusPayloadInput {
  orderId: string;
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

export const buildStatusPayload = ({
  orderId,
  context,
  bppId,
  bppUri,
  transactionId,
  messageId,
  now,
}: BuildStatusPayloadInput): OndcStatusRequest => ({
  context: {
    ...context,
    action: "status",
    bpp_id: bppId,
    bpp_uri: bppUri,
    transaction_id: transactionId,
    message_id: messageId,
    timestamp: now,
    ttl: "PT30S",
  },
  message: { order_id: orderId },
});
