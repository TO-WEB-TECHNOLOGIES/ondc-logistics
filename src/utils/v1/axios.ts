import axios from "axios";
import { GATEWAY_URL } from "../../constants/v1/appConstants.js";
import { pushTransactionLog, getNoApiType } from "../../services/network-observability.service.js";

export const api = axios.create({
  baseURL: GATEWAY_URL,
  headers: {
    "Content-Type": "application/json",
  },
  timeout: 30_000,
});

api.interceptors.request.use(
  (config) => {
    // Fire-and-forget NO API log push after request is sent
    const action = extractActionFromUrl(config.url ?? "", config.baseURL ?? "");
    if (action) {
      const noType = getNoApiType(action, false);
      pushTransactionLog(noType, {
        context: extractContextFromData(config.data),
        message: extractMessageFromData(config.data),
      });
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  },
);

api.interceptors.response.use(
  (response) => {
    // Fire-and-forget NO API log push after response is received
    const action = extractActionFromUrl(response.config.url ?? "", response.config.baseURL ?? "");
    if (action) {
      const noType = getNoApiType(action, true);
      const payload = extractContextAndMessage(response.data);
      if (payload) {
        pushTransactionLog(noType, payload);
      }
    }

    return response;
  },
  (error) => {
    // Still push to NO API on error responses (NACK scenarios)
    const action = extractActionFromUrl(error.config?.url ?? "", error.config?.baseURL ?? "");
    if (action) {
      const noType = getNoApiType(action, true);
      const payload = extractContextAndMessage(error.response?.data ?? {});
      if (payload) {
        pushTransactionLog(noType, payload);
      }
    }

    return Promise.reject(error);
  },
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extracts the ONDC action from the request URL.
 * Handles direct BPP-uri-as-baseURL calls (e.g., bppUri/on_confirm) and gateway-style paths.
 */
function extractActionFromUrl(url: string, baseURL: string): string | null {
  if (!url) return null;

  let path = url;
  if (baseURL && url.startsWith(baseURL)) {
    path = url.slice(baseURL.length).replace(/^\//, "");
  } else if (url.startsWith("http")) {
    try {
      const u = new URL(url);
      path = u.pathname.replace(/^\//, "");
    } catch {
      return null;
    }
  }

  // Remove version prefix like /v1/api/ if present
  path = path.replace(/^v\d+\/api\//, "");

  const action = path.split("/")[0];
  return action || null;
}

/**
 * Extracts the ONDC context object from axios request/response data.
 * Guards against primitives (number, string, boolean) being used with the `in` operator.
 */
function extractContextFromData(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const obj = data as Record<string, unknown>;

  if (Object.prototype.hasOwnProperty.call(obj, "context") && typeof obj.context === "object") {
    return obj.context as Record<string, unknown>;
  }

  return {};
}

/**
 * Extracts the ONDC message object from axios request/response data.
 * Guards against primitives (number, string, boolean) being used with the `in` operator.
 */
function extractMessageFromData(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const obj = data as Record<string, unknown>;

  if (Object.prototype.hasOwnProperty.call(obj, "message") && typeof obj.message === "object") {
    return obj.message as Record<string, unknown>;
  }

  return {};
}

/**
 * Extracts both context and message from a response payload.
 * Used for NO API push on response.
 */
function extractContextAndMessage(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};

  const context = extractContextFromData(data);
  const message = extractMessageFromData(data);

  return { context, message };
}
