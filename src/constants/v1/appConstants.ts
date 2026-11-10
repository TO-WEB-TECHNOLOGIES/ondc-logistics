import dotenv from "dotenv";
dotenv.config();
import { ENV, envFor } from "../../config/env.js";

// City codes (formerly the hardcoded presentCityCodes array here) are now admin-managed via
// the city_code DB table — see services/city-code.service.ts's getActiveCityCodes() and the
// /admin/city-codes CRUD API (admin.routes.ts).

const BFF = envFor("BFF")!;

// ONDC Keys
const SIGNING_PRIVATE_KEY = envFor("SIGNING_PRIVATE_KEY")!;
const SIGNING_PUBLIC_KEY = envFor("SIGNING_PUBLIC_KEY")!;
const ENCRYPTION_PRIVATE_KEY = envFor("ENCRYPTION_PRIVATE_KEY")!;
const ENCRYPTION_PUBLIC_KEY = envFor("ENCRYPTION_PUBLIC_KEY")!;
const UNIQUE_KEY_ID = envFor("UNIQUE_KEY_ID")!;

// PLATFORM DETAILS
const SUBSCRIBER_ID = envFor("SUBSCRIBER_ID")!;
// const DOMAIN = process.env.DOMAIN!;
// const APP_TYPE = process.env.APP_TYPE!;
// const APP_OPS_NO = Number(process.env.APP_OPS_NO || 1);
// const CORE_VERSION = process.env.CORE_VERSION || "1.2.0";
// const BAP_URI = `https://${SUBSCRIBER_ID}/api/v1`;
// const BAP_FINDER_FEE_TYPE = process.env.BFF_TYPE || "percent";

// APP CONFIGURATION
// ENV (PROD | PREPROD) and envFor() live in config/env.ts — envFor("X") reads
// `${ENV}_X` when set, else plain X.

// Network Observability (NO) API — ONDC compliance transaction-log push
const NO_ANALYTICS_TOKEN = envFor("NO_ANALYTICS_TOKEN") || "";

// PROD_REGISTRY_URL / PREPROD_REGISTRY_URL (and the plain REGISTRY_URL fallback) via envFor.
const REGISTRY_URL =
  envFor("REGISTRY_URL") ||
  (ENV === "PROD" ? "https://registry.ondc.org/" : "https://preprod.registry.ondc.org/");

const GATEWAY_URL =
  envFor("GATEWAY_URL") ||
  (ENV === "PROD" ? "https://prod.gateway.ondc.org/" : "https://preprod.gateway.ondc.org/");

export const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const nonNegativeInt = (raw: string | undefined, fallback: number) => {
  const value = Number(raw);
  return raw !== undefined && raw.trim() !== "" && Number.isInteger(value) && value >= 0
    ? value
    : fallback;
};

// Outbound ONDC requests (src/utils/ondc-requests.ts): how long to wait for the
// counterparty's sync ACK/NACK per attempt, and how many extra attempts to make
// (same transaction_id + message_id, fresh timestamp/signature) after a timeout.
export const ONDC_ACK_TIMEOUT_MS = nonNegativeInt(process.env.ONDC_ACK_TIMEOUT_MS, 15_000);
export const ONDC_ACK_RETRIES = nonNegativeInt(process.env.ONDC_ACK_RETRIES, 2);

export {
  BFF,
  SIGNING_PRIVATE_KEY,
  SIGNING_PUBLIC_KEY,
  ENCRYPTION_PRIVATE_KEY,
  ENCRYPTION_PUBLIC_KEY,
  UNIQUE_KEY_ID,
  ENV,
  REGISTRY_URL,
  GATEWAY_URL,
  SUBSCRIBER_ID,
  NO_ANALYTICS_TOKEN,
};
