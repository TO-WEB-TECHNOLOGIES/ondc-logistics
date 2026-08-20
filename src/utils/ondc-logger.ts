/**
 * ONDC Structured Logger
 *
 * Provides consistent, structured logging for every ONDC API interaction:
 *   - BAP → BPP outbound requests (select, init, confirm, status, cancel, track, update, search)
 *   - BPP → BAP inbound webhooks (on_select, on_init, on_confirm, on_status, on_cancel, on_track, on_update, on_search)
 *   - SSE push events (local delivery, pubsub broadcast, or skipped)
 *
 * Every entry includes: timestamp, direction, action, transaction_id, message_id,
 * bap_id, bpp_id, order_id, and the full payload (truncated at 10KB).
 *
 * Usage:
 *   import { ondcLog } from "../utils/ondc-logger.js";
 *   ondcLog.outbound("select", payload, { bppUri, httpStatus: 200, durationMs: 120 });
 *   ondcLog.inbound("on_status", payload, { ackStatus: "ACK" });
 *   ondcLog.sse("on_status", sseData, transactionId, clientId, "delivered_locally");
 */

import { logger } from "./logger.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type OndcDirection = "BAP→BPP" | "BPP→BAP";
export type OndcAction =
  | "search"
  | "select"
  | "init"
  | "confirm"
  | "status"
  | "cancel"
  | "track"
  | "update"
  | "issue"
  | "issue_status"
  | "on_search"
  | "on_select"
  | "on_init"
  | "on_confirm"
  | "on_status"
  | "on_cancel"
  | "on_track"
  | "on_update"
  | "on_issue"
  | "on_issue_status"
  | "on_recon"
  | "catalog_rejection";

export type SSEDeliveryType =
  | "delivered_locally"
  | "pubsub_broadcast"
  | "skipped"
  | "no_clientid"
  | "no_clientid_pubsub_broadcast"
  | "pubsub_delivery_failed";

export interface OndcLogMeta {
  transaction_id?: string;
  message_id?: string;
  bap_id?: string;
  bpp_id?: string;
  order_id?: string;
  bpp_uri?: string;
  http_status?: number;
  duration_ms?: number;
  ack_status?: "ACK" | "NACK";
  sse_delivery?: SSEDeliveryType;
  sse_client_id?: string;
  sse_event_name?: string;
  sse_payload_bytes?: number;
  error?: string;
  [key: string]: unknown;
}

// ─── Payload truncation ───────────────────────────────────────────────────────

const MAX_PAYLOAD_SIZE = 10 * 1024; // 10 KB

function truncatePayload(payload: unknown): string {
  const str = JSON.stringify(payload);
  if (str.length <= MAX_PAYLOAD_SIZE) return str;
  return (
    str.slice(0, MAX_PAYLOAD_SIZE) +
    `... [TRUNCATED ${str.length - MAX_PAYLOAD_SIZE} bytes]`
  );
}

// ─── Core log builder ─────────────────────────────────────────────────────────

function buildOndcLog(
  direction: OndcDirection,
  action: OndcAction,
  payload: unknown,
  meta: OndcLogMeta = {},
) {
  const {
    transaction_id,
    message_id,
    bap_id,
    bpp_id,
    order_id,
    bpp_uri,
    http_status,
    duration_ms,
    ack_status,
    sse_delivery,
    sse_client_id,
    sse_event_name,
    sse_payload_bytes,
    error,
    ...rest
  } = meta;

  const structured: Record<string, unknown> = {
    direction,
    action,
    ...(transaction_id && { transaction_id }),
    ...(message_id && { message_id }),
    ...(bap_id && { bap_id }),
    ...(bpp_id && { bpp_id }),
    ...(order_id && { order_id }),
    ...(bpp_uri && { bpp_uri }),
    ...(http_status && { http_status }),
    ...(duration_ms && { duration_ms }),
    ...(ack_status && { ack_status }),
    ...(sse_delivery && { sse_delivery }),
    ...(sse_client_id && { sse_client_id }),
    ...(sse_event_name && { sse_event_name }),
    ...(sse_payload_bytes && { sse_payload_bytes }),
    ...(error && { error }),
    ...(Object.keys(rest).length > 0 && { extra: rest }),
    payload: truncatePayload(payload),
  };

  return structured;
}

// ─── Outbound: BAP → BPP ─────────────────────────────────────────────────────

/**
 * Logs a BAP → BPP outbound ONDC request.
 *
 * @param action — ONDC action name (e.g. "select", "status", "cancel")
 * @param payload — full request payload sent to BPP
 * @param meta — optional structured fields (transaction_id, bpp_uri, http_status, etc.)
 */
export function logOutbound(
  action: OndcAction,
  payload: unknown,
  meta: OndcLogMeta = {},
) {
  const context = (payload as any)?.context ?? {};
  const message = (payload as any)?.message ?? {};

  const fullMeta: OndcLogMeta = {
    transaction_id: meta.transaction_id ?? context?.transaction_id,
    message_id: meta.message_id ?? context?.message_id,
    bap_id: meta.bap_id ?? context?.bap_id,
    bpp_id: meta.bpp_id ?? context?.bpp_id,
    order_id: meta.order_id ?? message?.order_id,
    bpp_uri: meta.bpp_uri,
    http_status: meta.http_status,
    duration_ms: meta.duration_ms,
    error: meta.error,
    ...meta,
  };

  const logData = buildOndcLog("BAP→BPP", action, payload, fullMeta);
  logger.info("ondc", `[OUTBOUND] ${action.toUpperCase()} → BPP`, logData);
}

/**
 * Logs the response received from a BPP for an outbound BAP request.
 *
 * @param action — ONDC action name
 * @param outboundPayload — the original request payload
 * @param responsePayload — the response payload from BPP
 * @param meta — http_status, duration_ms, error, etc.
 */
export function logOutboundResponse(
  action: OndcAction,
  outboundPayload: unknown,
  responsePayload: unknown,
  meta: OndcLogMeta = {},
) {
  const logData = buildOndcLog("BAP→BPP", action, responsePayload, {
    ...meta,
    direction_note: "response",
  });
  logger.info(
    "ondc",
    `[OUTBOUND] ${action.toUpperCase()} ← BPP RESPONSE`,
    logData,
  );
}

// ─── Inbound: BPP → BAP webhook ───────────────────────────────────────────────

/**
 * Logs a BPP → BAP inbound webhook (received by our webhook handler).
 *
 * @param action — ONDC action name (e.g. "on_status", "on_cancel")
 * @param payload — full webhook payload received from BPP
 * @param meta — transaction_id, message_id, bpp_id, ack_status, etc.
 */
export function logInbound(
  action: OndcAction,
  payload: unknown,
  meta: OndcLogMeta = {},
) {
  const context = (payload as any)?.context ?? {};
  const message = (payload as any)?.message ?? {};
  const order = message?.order ?? {};

  const fullMeta: OndcLogMeta = {
    transaction_id: meta.transaction_id ?? context?.transaction_id,
    message_id: meta.message_id ?? context?.message_id,
    bap_id: meta.bap_id ?? context?.bap_id,
    bpp_id: meta.bpp_id ?? context?.bpp_id,
    order_id: meta.order_id ?? order?.id,
    ack_status: meta.ack_status,
    error: meta.error,
    ...meta,
  };

  const logData = buildOndcLog("BPP→BAP", action, payload, fullMeta);
  logger.info(
    "ondc",
    `[INBOUND] ${action.toUpperCase()} ← BPP WEBHOOK`,
    logData,
  );
}

/**
 * Logs ACK/NACK sent in response to an inbound webhook.
 *
 * @param action — ONDC action name
 * @param payload — the webhook payload (for context)
 * @param ackStatus — "ACK" or "NACK"
 * @param httpStatusCode — HTTP status code sent (200, 401, etc.)
 */
export function logInboundAck(
  action: OndcAction,
  payload: unknown,
  ackStatus: "ACK" | "NACK",
  httpStatusCode: number,
) {
  const context = (payload as any)?.context ?? {};

  logger.info(
    "ondc",
    `[INBOUND] ${action.toUpperCase()} → ${ackStatus} (HTTP ${httpStatusCode})`,
    {
      direction: "BAP→BPP",
      action,
      transaction_id: context?.transaction_id,
      message_id: context?.message_id,
      bpp_id: context?.bpp_id,
      ack_status: ackStatus,
      http_status: httpStatusCode,
      payload: truncatePayload(payload),
    },
  );
}

// ─── SSE Push ─────────────────────────────────────────────────────────────────

/**
 * Logs an SSE push event attempt.
 *
 * @param eventName — SSE event name (e.g. "on_status", "delivered", "status_polled")
 * @param data — the SSE event data payload
 * @param transactionId — ONDC transaction_id
 * @param clientId — resolved SSE clientId
 * @param delivery — delivery outcome
 * @param meta — additional fields
 */
export function logSSE(
  eventName: string,
  data: unknown,
  transactionId: string | undefined,
  clientId: string | undefined,
  delivery: SSEDeliveryType,
  meta: OndcLogMeta = {},
) {
  const payloadBytes = JSON.stringify(data).length;

  logger.info("ondc", `[SSE] event=${eventName} → ${delivery}`, {
    direction: "SSE",
    sse_event_name: eventName,
    transaction_id: transactionId,
    sse_client_id: clientId,
    sse_delivery: delivery,
    sse_payload_bytes: payloadBytes,
    ...meta,
  });
}

/**
 * Logs SSE client registration.
 */
export function logSSERegister(clientId: string, instanceId: string) {
  logger.info("ondc", `[SSE] Client registered`, {
    direction: "SSE",
    sse_event: "register",
    sse_client_id: clientId,
    instance_id: instanceId,
  });
}

/**
 * Logs SSE client unregistration.
 */
export function logSSEUnregister(clientId: string) {
  logger.info("ondc", `[SSE] Client unregistered`, {
    direction: "SSE",
    sse_event: "unregister",
    sse_client_id: clientId,
  });
}

/**
 * Logs Pub/Sub event received from Redis.
 */
export function logSSEPubsubReceive(
  channel: string,
  clientId: string,
  eventName: string,
  dataSize: number,
) {
  logger.info("ondc", `[SSE] Pub/Sub event received`, {
    direction: "SSE",
    sse_event: "pubsub_receive",
    channel,
    sse_client_id: clientId,
    sse_event_name: eventName,
    sse_payload_bytes: dataSize,
  });
}

// ─── Convenience re-exports ───────────────────────────────────────────────────

export const ondcLog = {
  outbound: logOutbound,
  outboundResponse: logOutboundResponse,
  inbound: logInbound,
  inboundAck: logInboundAck,
  sse: logSSE,
  sseRegister: logSSERegister,
  sseUnregister: logSSEUnregister,
  ssePubsubReceive: logSSEPubsubReceive,
};

export default ondcLog;
