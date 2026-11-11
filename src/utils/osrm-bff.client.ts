import { envFor } from "../config/env.js";
import { logger } from "./logger.js";

/**
 * Fire-and-forget forward of each processed /on_track to osrm-bff, which adds
 * road routes for the frontend's live-tracking map. Internal, non-ONDC call:
 * it never touches the ONDC ACK, the DB transaction or the existing
 * order_tracking events.
 *
 * Config (via envFor, so PREPROD_/PROD_ variants work):
 *   OSRM_BFF_URL         base URL; empty = feature off
 *   OSRM_BFF_TOKEN       sent as X-Internal-Token when set
 *   OSRM_BFF_TIMEOUT_MS  per-call timeout, default 2000
 *
 * Never throws, no retries, no queue (the next /on_track supersedes this one).
 * Logs orderId/transactionId, status and latency only — never the payload,
 * which carries GPS trails (personal data).
 */
const BASE_URL = (envFor("OSRM_BFF_URL") ?? "").trim().replace(/\/+$/, "");
const TOKEN = (envFor("OSRM_BFF_TOKEN") ?? "").trim();
const TIMEOUT_MS = (() => {
  const raw = Number(envFor("OSRM_BFF_TIMEOUT_MS"));
  return Number.isFinite(raw) && raw > 0 ? raw : 2000;
})();

export const osrmBffEnabled = (): boolean => BASE_URL !== "";

export interface OsrmBffOnTrack {
  event: "order_tracking";
  transactionId: string;
  orderId: string;
  gps?: string;
  fulfillmentState?: string;
  startGps?: string;
  endGps?: string;
  [key: string]: unknown;
}

/** Drops undefined, null and "" so unknown values are omitted, never sent empty. */
export const omitEmpty = <T extends Record<string, unknown>>(value: T): T =>
  Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined && v !== null && v !== ""),
  ) as T;

export async function forwardOnTrack(payload: OsrmBffOnTrack): Promise<void> {
  if (!osrmBffEnabled()) return;
  const ids = { orderId: payload.orderId, transactionId: payload.transactionId };
  const started = Date.now();
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (TOKEN) headers["X-Internal-Token"] = TOKEN;
    const res = await fetch(`${BASE_URL}/internal/v1/logistics/on_track`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const meta = { ...ids, status: res.status, ms: Date.now() - started };
    if (res.ok) logger.info("osrm-bff", "on_track forwarded", meta);
    else logger.warn("osrm-bff", "on_track forward rejected", meta);
  } catch (error) {
    logger.warn("osrm-bff", "on_track forward failed", {
      ...ids,
      error: error instanceof Error ? error.name : String(error),
      ms: Date.now() - started,
    });
  }
}
