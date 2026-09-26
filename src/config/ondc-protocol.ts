/**
 * Static ONDC context fields for every outbound request. Single definition,
 * shared by routes/ondc.routes.ts and routes/issue.routes.ts (previously
 * duplicated in both).
 *
 * `city` here is only the fallback for a brand-new /search. Every later call
 * on a transaction takes its city (and domain/country/core_version) from that
 * transaction's stored /search context — see
 * repositories/transaction-context.ts.
 */
export const ondcProtocol = {
  domain: process.env.ONDC_DOMAIN ?? "nic2004:60232",
  country: process.env.ONDC_COUNTRY ?? "IND",
  city: process.env.ONDC_CITY ?? "std:080",
  coreVersion: process.env.ONDC_CORE_VERSION ?? "1.2.0",
  bapId: process.env.BAP_ID ?? process.env.SUBSCRIBER_ID ?? "",
  bapUri: process.env.BAP_URI ?? "",
  ttl: process.env.ONDC_TTL ?? "PT30S",
};

export type OndcProtocol = typeof ondcProtocol;
