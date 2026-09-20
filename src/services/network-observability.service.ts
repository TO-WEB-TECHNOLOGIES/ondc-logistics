/**
 * Network Observability (NO) Service — Push Transaction Logs to ONDC Analytics
 *
 * After every ONDC API call (request or response), this service fires a POST to the
 * ONDC analytics endpoint to log the transaction for network observability.
 *
 * This is a fire-and-forget call — errors are logged but never thrown/cascaded
 * so they never affect the main API flow.
 *
 * Pre-prod endpoint: https://analytics-api-pre-prod.aws.ondc.org/v1/api/push-txn-logs
 * Auth: Bearer token from NP portal (valid 10 days for pre-prod only)
 *
 * Environment:
 *   - PREPROD: always log NO API responses (success and failure) for debugging
 *   - PROD: only log when NO API returns an error response
 *
 * Ported from ondc-api's src/services/network-observability.service.ts (same logic,
 * paths adjusted for this repo's layout).
 */

import axios from "axios";
import { ENV, NO_ANALYTICS_TOKEN } from "../constants/v1/appConstants.js";
import { logger } from "../utils/logger.js";
import { utcNowISO } from "../utils/indian-time.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const NO_API_BASE_URL = ENV !== "PROD" ? "https://analytics-api-pre-prod.aws.ondc.org" : "https://analytics-api.aws.ondc.org";
const NO_API_PATH = "/v1/api/push-txn-logs";

const noApiClient = axios.create({
  baseURL: NO_API_BASE_URL,
  timeout: 5000, // 5 second timeout — fire and forget
});

// ─── NO API Response Types ────────────────────────────────────────────────────

interface NoApiSuccessResponse {
  message: "Successful";
  warnings?: Array<{
    code: number;
    type: string;
    message: string;
    path: string;
  }>;
}

interface NoApiErrorResponse {
  errors: Array<{
    error_code: number;
    message: string;
    path: string;
    error_description: string;
  }>;
}

type NoApiResponse = NoApiSuccessResponse | NoApiErrorResponse;

// ─── Token Expiry Check ────────────────────────────────────────────────────────

const NO_ANALYTICS_TOKEN_LAST_UPDATED = process.env.NO_ANALYTICS_TOKEN_LAST_UPDATED; // DD-MM-YYYY

function checkTokenExpiry(): void {
  if (!NO_ANALYTICS_TOKEN_LAST_UPDATED) {
    logger.warn(
      "network-observability",
      "NO_ANALYTICS_TOKEN_LAST_UPDATED is not set — cannot check token expiry",
    );
    return;
  }

  const [day, month, year] = NO_ANALYTICS_TOKEN_LAST_UPDATED.split("-").map(Number);
  if (!day || !month || !year) {
    logger.warn(
      "network-observability",
      `Invalid NO_ANALYTICS_TOKEN_LAST_UPDATED format: "${NO_ANALYTICS_TOKEN_LAST_UPDATED}" — expected DD-MM-YYYY`,
    );
    return;
  }

  const tokenDate = new Date(year, month - 1, day);
  const now = new Date(utcNowISO());
  const diffMs = now.getTime() - tokenDate.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays >= 360) {
    logger.warn(
      "network-observability",
      `NO_ANALYTICS_TOKEN is ${diffDays} days old (set on ${NO_ANALYTICS_TOKEN_LAST_UPDATED}) — token validity is 365 days, please update soon`,
    );
  }
}

// Run expiry check once at service load
checkTokenExpiry();

// ─── Public Interface ─────────────────────────────────────────────────────────

/**
 * Pushes a transaction log to the ONDC Network Observability API.
 *
 * Called from axios interceptors after every ONDC API request/response.
 * This is fire-and-forget — errors are caught and logged but never propagated.
 *
 * @param type  — the NO API "type" field (e.g., "search", "on_search", "confirm_response")
 * @param payload — the full { context, message } payload from the ONDC API call
 */
export function pushTransactionLog(type: string, payload: Record<string, unknown>): void {
  // This push cannot be disabled — it's ONDC's own network-observability compliance
  // reporting, not diagnostic noise. Both failure branches below (NO API error response,
  // network/request failure) already log at ERROR, so a failed push is always
  // critical/console-visible.

  // If no token configured, skip silently
  if (!NO_ANALYTICS_TOKEN) {
    logger.warn("network-observability", "NO_ANALYTICS_TOKEN not set, skipping log push", { type });
    return;
  }

  const noPayload = { type, data: payload };

  // In PREPROD, always log the full request body sent to NO API for debugging
  if (ENV === "PREPROD") {
    logger.info("network-observability", "NO API request payload", {
      type,
      noPayload,
    });
  }

  noApiClient
    .post(NO_API_PATH, noPayload, {
      headers: {
        Authorization: `Bearer ${NO_ANALYTICS_TOKEN}`,
        "Content-Type": "application/json",
      },
    })
    .then((response) => {
      const data = response.data;

      // In PREPROD, always log raw response body for debugging
      if (ENV === "PREPROD") {
        logger.info("network-observability", "NO API raw response", {
          type,
          status: response.status,
          rawData: data,
        });
      }

      // Guard against non-object responses (primitives: number 1, string "OK", boolean, null, etc.)
      // typeof 1 === "number", typeof null === "object", so we need both checks
      if (typeof data !== "object" || data === null || Array.isArray(data)) {
        // HTTP 200 means success — non-object body is non-standard but still a success response.
        // Log at INFO in both PREPROD and PROD for visibility; downgrade from ERROR.
        logger.info("network-observability", "NO API push success (non-standard body)", {
          type,
          responseData: data,
          responseType: typeof data,
          status: response.status,
        });
        return;
      }

      const noApiData = data as NoApiResponse;

      if (isSuccessResponse(noApiData)) {
        // Success — log warning details if any
        if (noApiData.warnings && noApiData.warnings.length > 0) {
          logger.warn("network-observability", "NO API accepted with warnings", {
            type,
            warnings: noApiData.warnings,
          });
        } else {
          logger.info("network-observability", "NO API push success", { type });
        }
      } else {
        // Error response from NO API — always log
        logger.error("network-observability", "NO API returned error", {
          type,
          errors: noApiData.errors,
        });
      }
    })
    .catch((err) => {
      // In PREPROD, always log raw response for debugging
      if (ENV === "PREPROD") {
        logger.info("network-observability", "NO API raw error response", {
          type,
          error: err?.message ?? "unknown",
          status: err?.response?.status,
          rawData: err?.response?.data,
        });
      }

      // Network/error — always log for debugging
      logger.error("network-observability", "NO API push failed", {
        type,
        error: err?.message ?? "unknown",
        status: err?.response?.status,
        // Guard against non-object response data
        data: (err?.response?.data && typeof err.response.data === "object" && !Array.isArray(err.response.data))
          ? err.response.data
          : String(err?.response?.data ?? "unknown"),
      });
    });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isSuccessResponse(data: NoApiResponse): data is NoApiSuccessResponse {
  return "message" in data && data.message === "Successful";
}

/**
 * Determines the NO API "type" field from an ONDC action and direction.
 *
 * @param action   — ONDC action name (e.g., "search", "on_search", "confirm")
 * @param isAckNack — true if this is a synchronous ACK/NACK response
 */
export function getNoApiType(action: string, isAckNack: boolean): string {
  if (isAckNack) {
    return `${action}_response`;
  }
  return action;
}

/**
 * Pushes a transaction log for an inbound ONDC request received via Express.
 *
 * This is the inbound counterpart to the axios interceptor's outbound push.
 * For inbound requests TO us (e.g., /on_confirm, /on_status from the BPP), the type is
 * simply the action name — these are requests we received, not our responses.
 *
 * Fire-and-forget — errors are caught and logged but never propagated.
 *
 * @param requestBody — raw Express request body (already parsed JSON)
 */
export function pushTransactionLogFromRequest(requestBody: Record<string, unknown>): void {
  if (!NO_ANALYTICS_TOKEN) return;

  if (!requestBody?.context || typeof requestBody.context !== "object") return;

  const context = requestBody.context as Record<string, unknown>;
  const action = context?.action as string | undefined;
  if (!action) return;

  const message = (requestBody?.message && typeof requestBody.message === "object"
    ? requestBody.message
    : {}) as Record<string, unknown>;

  pushTransactionLog(action, { context, message });
}
