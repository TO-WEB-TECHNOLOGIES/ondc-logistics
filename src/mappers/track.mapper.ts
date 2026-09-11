/**
 * Mapper for /track.
 *
 * Contract reference: docs/ondc/ondc logistics.docx, "/track" section —
 * same minimal shape as /status: `message: { order_id }`.
 */
import type { OndcContext } from "../types/search/ondc.js";
import type { OndcTrackRequest } from "../types/track/ondc.js";

export interface BuildTrackPayloadInput {
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

export const buildTrackPayload = ({
  orderId,
  context,
  bppId,
  bppUri,
  transactionId,
  messageId,
  now,
}: BuildTrackPayloadInput): OndcTrackRequest => ({
  context: {
    ...context,
    action: "track",
    bpp_id: bppId,
    bpp_uri: bppUri,
    transaction_id: transactionId,
    message_id: messageId,
    timestamp: now,
    ttl: "PT30S",
  },
  message: { order_id: orderId },
});
