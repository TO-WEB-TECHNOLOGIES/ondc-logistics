/**
 * Mapper for /status.
 *
 * Contract reference: docs/ondc/ondc logistics.docx, "/status" section —
 * the request is the simplest of any order-lifecycle API: just
 * `message: { order_id }`, no nested order object.
 */
import { buildRequestContext } from "../utils/ondc-context.js";
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
  context: buildRequestContext("status", {
    base: context,
    bppId: bppId,
    bppUri: bppUri,
    transactionId: transactionId,
    messageId: messageId,
    timestamp: now,
  }),
  message: { order_id: orderId },
});
