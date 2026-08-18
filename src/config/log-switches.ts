import { fillAndStroke } from "pdfkit";

/**
 * Global kill switches for logging mechanisms.
 *
 * Plain in-process state today — edit this file and redeploy to change. Deliberately kept
 * as a single small object so it can be swapped for a DB/Redis-backed store later (same
 * shape, same call sites in logger.ts / network-observability.service.ts unaffected).
 */
export const logSwitches = {
  /** General logger.* calls (the "normal" catch-all category — controllers/services). */
  app: true,
  /** ondcLog.* calls (the "ondc" namespace — inbound/outbound/ack/sse traffic logging). */
  ondc: true,
  /** The frontend API request/response + SSE-notification logger (the "api" namespace). */
  api: true,
};

// NOTE (2026-07-04): the external NO-API push (network-observability.service.ts) used to
// have a `noApiPush` switch here — removed. That push is ONDC's own network-observability
// compliance reporting, not diagnostic noise, and must always run; it can no longer be
// disabled via this file.
