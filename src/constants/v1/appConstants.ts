import dotenv from "dotenv";
dotenv.config();

// City codes (formerly the hardcoded presentCityCodes array here) are now admin-managed via
// the city_code DB table — see services/city-code.service.ts's getActiveCityCodes() and the
// /admin/city-codes CRUD API (admin.routes.ts).

const BFF = process.env.BFF!;

// ONDC Keys
const SIGNING_PRIVATE_KEY = process.env.SIGNING_PRIVATE_KEY!;
const SIGNING_PUBLIC_KEY = process.env.SIGNING_PUBLIC_KEY!;
const ENCRYPTION_PRIVATE_KEY = process.env.ENCRYPTION_PRIVATE_KEY!;
const ENCRYPTION_PUBLIC_KEY = process.env.ENCRYPTION_PUBLIC_KEY!;
const UNIQUE_KEY_ID = process.env.UNIQUE_KEY_ID!;

// PLATFORM DETAILS
const SUBSCRIBER_ID = process.env.SUBSCRIBER_ID!;
// const DOMAIN = process.env.DOMAIN!;
// const APP_TYPE = process.env.APP_TYPE!;
// const APP_OPS_NO = Number(process.env.APP_OPS_NO || 1);
// const CORE_VERSION = process.env.CORE_VERSION || "1.2.0";
// const BAP_URI = `https://${SUBSCRIBER_ID}/api/v1`;
// const BAP_FINDER_FEE_TYPE = process.env.BFF_TYPE || "percent";

// APP CONFIGURATION
const ENV = (process.env.ENV || "PREPROD") as "PROD" | "PREPROD";

const REGISTRY_URL =
  ENV === "PROD"
    ? process.env.PROD_REGISTRY_URL || "https://registry.ondc.org/"
    : process.env.PREPROD_REGISTRY_URL || "https://preprod.registry.ondc.org/";

const GATEWAY_URL =
  ENV === "PROD"
    ? process.env.PROD_GATEWAY_URL || "https://prod.gateway.ondc.org/"
    : process.env.PREPROD_GATEWAY_URL || "https://preprod.gateway.ondc.org/";

export const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

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
};
