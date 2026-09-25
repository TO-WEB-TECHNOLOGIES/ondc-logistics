import { api } from "./v1/axios.js";
import { createAuthorizationHeader } from "./crypto.js";
import ondcLog, { OndcAction, OndcLogMeta } from "./ondc-logger.js";
import {
  ONDC_ACK_RETRIES,
  ONDC_ACK_TIMEOUT_MS,
} from "../constants/v1/appConstants.js";

/** Pause before re-sending after a retriable failure that returned quickly (503/504/66001). */
const RETRY_BACKOFF_MS = 1_000;
/** Contract "Rules for order confirmation": LSP NACK 66001 on /confirm is retriable. */
const RETRIABLE_NACK_CODES: Partial<Record<OndcAction, string[]>> = {
  confirm: ["66001"],
};

/** The counterparty answered our request with a sync NACK. Not retried (except RETRIABLE_NACK_CODES). */
export class OndcNackError extends Error {
  constructor(
    readonly action: OndcAction,
    readonly nack: { type?: string; code?: string; message?: string; path?: string },
    readonly httpStatus: number,
    readonly attempts: number,
  ) {
    super(
      `${action} NACKed by counterparty${nack.code ? ` (${nack.code})` : ""}${nack.message ? `: ${nack.message}` : ""}`,
    );
    this.name = "OndcNackError";
  }
}

/** No sync ACK/NACK within ONDC_ACK_TIMEOUT_MS on any attempt. */
export class OndcAckTimeoutError extends Error {
  constructor(
    readonly action: OndcAction,
    readonly attempts: number,
    readonly timeoutMs: number,
    readonly lastError: string,
  ) {
    super(
      `${action} got no ACK/NACK after ${attempts} attempt(s) of ${timeoutMs}ms (last: ${lastError})`,
    );
    this.name = "OndcAckTimeoutError";
  }
}

type AttemptOutcome =
  | { kind: "ack"; response: Awaited<ReturnType<typeof api.post>> }
  | { kind: "nack"; error: OndcNackError; retriable: boolean }
  | { kind: "retry"; reason: string; wait: boolean }
  | { kind: "fail"; error: unknown };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function nackOf(data: unknown) {
  const body = data as { message?: { ack?: { status?: unknown } }; error?: Record<string, unknown> } | undefined;
  if (body?.message?.ack?.status !== "NACK") return undefined;
  const e = body.error ?? {};
  const str = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : undefined);
  return { type: str(e.type), code: str(e.code), message: str(e.message), path: str(e.path) };
}

/**
 * Signs and POSTs an ONDC request, waiting up to ONDC_ACK_TIMEOUT_MS for the
 * sync ACK/NACK. On timeout / no response / HTTP 503-504 (or a retriable
 * NACK code) it re-sends up to ONDC_ACK_RETRIES more times on the same
 * transaction_id + message_id with a fresh context.timestamp and signature.
 * The caller persists the request once, before calling this.
 *
 * Throws OndcNackError on a NACK, OndcAckTimeoutError when every attempt
 * timed out / failed retriably, or the original error otherwise.
 */
export async function sendOndcRequest(opts: {
  action: OndcAction;
  payload: Record<string, unknown>;
  baseURL?: string;
  logMeta?: OndcLogMeta;
}) {
  const { action, logMeta = {} } = opts;
  const baseURL = opts.baseURL?.replace(/\/$/, "");
  const attempts = 1 + ONDC_ACK_RETRIES;
  let lastReason = "no attempt made";

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const payload =
      attempt === 1 ? opts.payload : withFreshTimestamp(opts.payload);
    const meta = { bpp_uri: baseURL, ...logMeta, ...(attempt > 1 && { attempt }) };
    const outcome = await attemptOnce(action, payload, baseURL, meta, attempt);

    if (outcome.kind === "ack") return outcome.response;
    if (outcome.kind === "fail") throw outcome.error;
    if (outcome.kind === "nack") {
      if (!outcome.retriable || attempt === attempts) throw outcome.error;
      lastReason = outcome.error.message;
      console.log(`[ondc-requests] ${action} retriable NACK — re-sending`, {
        ...logMeta,
        attempt: attempt + 1,
        of: attempts,
        code: outcome.error.nack.code,
      });
      await sleep(RETRY_BACKOFF_MS);
      continue;
    }
    lastReason = outcome.reason;
    if (attempt < attempts) {
      console.log(`[ondc-requests] ${action} ${outcome.reason} — re-sending on same transaction_id/message_id`, {
        ...logMeta,
        attempt: attempt + 1,
        of: attempts,
      });
      if (outcome.wait) await sleep(RETRY_BACKOFF_MS);
    }
  }
  throw new OndcAckTimeoutError(action, attempts, ONDC_ACK_TIMEOUT_MS, lastReason);
}

async function attemptOnce(
  action: OndcAction,
  payload: Record<string, unknown>,
  baseURL: string | undefined,
  meta: OndcLogMeta,
  attempt: number,
): Promise<AttemptOutcome> {
  const authHeader = await createAuthorizationHeader({ payload });
  const startTime = Date.now();
  ondcLog.outbound(action, payload, meta);
  try {
    const response = await api.post(action, payload, {
      ...(baseURL ? { baseURL } : {}),
      timeout: ONDC_ACK_TIMEOUT_MS,
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
    });
    const nack = nackOf(response.data);
    ondcLog.outboundResponse(action, payload, response.data, {
      ...meta,
      http_status: response.status,
      duration_ms: Date.now() - startTime,
      ack_status: nack ? "NACK" : "ACK",
    });
    if (nack) return nackOutcome(action, nack, response.status, attempt);
    return { kind: "ack", response };
  } catch (err: any) {
    const status: number | undefined = err?.response?.status;
    ondcLog.outbound(action, payload, {
      ...meta,
      http_status: status,
      duration_ms: Date.now() - startTime,
      error: err?.message,
    });
    console.log(err?.response?.data ?? err?.message ?? err);

    const nack = nackOf(err?.response?.data);
    if (nack && status !== 503 && status !== 504)
      return nackOutcome(action, nack, status ?? 0, attempt);
    if (!err?.response) {
      const timedOut = err?.code === "ECONNABORTED" || err?.code === "ETIMEDOUT";
      return {
        kind: "retry",
        reason: timedOut
          ? `no ACK within ${ONDC_ACK_TIMEOUT_MS}ms`
          : `no response (${err?.code ?? err?.message ?? "network error"})`,
        wait: !timedOut,
      };
    }
    if (status === 503 || status === 504)
      return { kind: "retry", reason: `HTTP ${status}`, wait: true };
    return { kind: "fail", error: err };
  }
}

function nackOutcome(
  action: OndcAction,
  nack: NonNullable<ReturnType<typeof nackOf>>,
  httpStatus: number,
  attempt: number,
): AttemptOutcome {
  return {
    kind: "nack",
    error: new OndcNackError(action, nack, httpStatus, attempt),
    retriable: !!nack.code && (RETRIABLE_NACK_CODES[action] ?? []).includes(nack.code),
  };
}

/** Same request (transaction_id, message_id, body) with a new context.timestamp, so the retry is not treated as stale. */
function withFreshTimestamp(payload: Record<string, unknown>): Record<string, unknown> {
  const context = payload.context as Record<string, unknown> | undefined;
  if (!context || typeof context !== "object") return payload;
  return { ...payload, context: { ...context, timestamp: new Date().toISOString() } };
}
