/**
 * Static ONDC context fields for every outbound request. Single definition,
 * shared by routes/ondc.routes.ts and routes/issue.routes.ts (previously
 * duplicated in both).
 *
 * `city` here is only the fallback for a brand-new /search. Every later call
 * on a transaction takes its city (and domain/country/core_version) from that
 * transaction's stored /search context — see
 * repositories/transaction-context.ts.
 *
 * Values resolve via envFor(): `${ENV}_X` when set, else plain X.
 */
import { envFor } from "./env.js";

export const ondcProtocol = {
  domain: envFor("ONDC_DOMAIN") ?? "nic2004:60232",
  country: envFor("ONDC_COUNTRY") ?? "IND",
  city: envFor("ONDC_CITY") ?? "std:080",
  coreVersion: envFor("ONDC_CORE_VERSION") ?? "1.2.0",
  bapId: envFor("BAP_ID") ?? envFor("SUBSCRIBER_ID") ?? "",
  bapUri: envFor("BAP_URI") ?? "",
  ttl: envFor("ONDC_TTL") ?? "PT30S",
};

export type OndcProtocol = typeof ondcProtocol;
