import { api } from "./v1/axios.js";
import { createAuthorizationHeader } from "./crypto.js";
import ondcLog, { OndcAction, OndcLogMeta } from "./ondc-logger.js";

export async function sendOndcRequest(opts: {
  action: OndcAction;
  payload: Record<string, unknown>;
  baseURL?: string;
  logMeta?: OndcLogMeta;
}) {
  const { action, payload, logMeta = {} } = opts;
  const baseURL = opts.baseURL?.replace(/\/$/, "");
  const authHeader = await createAuthorizationHeader({ payload });

  const startTime = Date.now();
  ondcLog.outbound(action, payload, { bpp_uri: baseURL, ...logMeta });
  try {
    const response = await api.post(action, payload, {
      ...(baseURL ? { baseURL } : {}),
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
    });
    ondcLog.outboundResponse(action, payload, response.data, {
      bpp_uri: baseURL,
      http_status: response.status,
      duration_ms: Date.now() - startTime,
      ...logMeta,
    });
    return response;
  } catch (err: any) {
    ondcLog.outbound(action, payload, {
      bpp_uri: baseURL,
      http_status: err?.response?.status,
      duration_ms: Date.now() - startTime,
      error: err?.message,
      ...logMeta,
    });
    console.log(err?.response?.data ?? err?.message ?? err);
    throw err;
  }
}
