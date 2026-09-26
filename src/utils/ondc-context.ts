/**
 * Single place where ONDC `context` objects are created (outbound requests)
 * and checked (inbound callbacks).
 *
 * Contract ("Construct of APIs & transaction trail"): every request/response
 * pair is identified by transaction_id + message_id; a callback echoes the
 * transaction_id and message_id of the request it answers. All attribute
 * keys are mandatory unless the contract marks them optional — callbacks
 * carry no `ttl` in the contract examples (on_track does), so ttl is
 * optional on inbound and always set on outbound.
 */
import { randomUUID } from "node:crypto";
import type { OndcContext } from "../types/search/ondc.js";
import type { OndcProtocol } from "../config/ondc-protocol.js";

/** Fields that stay fixed for every call on a transaction. */
export type OndcContextBase = Pick<
  OndcContext,
  "domain" | "country" | "city" | "core_version" | "bap_id" | "bap_uri"
>;

export const DEFAULT_REQUEST_TTL = "PT30S";

/** camelCase protocol config → snake_case context base. */
export const contextBaseFromProtocol = (
  protocol: Pick<
    OndcProtocol,
    "domain" | "country" | "city" | "coreVersion" | "bapId" | "bapUri"
  >,
): OndcContextBase => ({
  domain: protocol.domain,
  country: protocol.country,
  city: protocol.city,
  core_version: protocol.coreVersion,
  bap_id: protocol.bapId,
  bap_uri: protocol.bapUri,
});

export interface RequestContextInput {
  base: OndcContextBase;
  /** Same for every call on one transaction (search → init → confirm → post-order). */
  transactionId: string;
  /** New per request; the callback must echo it. Pass the stored one on a retry. */
  messageId?: string;
  /** Omitted on /search (sent via gateway, LSP unknown). */
  bppId?: string;
  bppUri?: string;
  timestamp?: string;
  ttl?: string;
}

/** Builds an outbound request context in contract key order. */
export function buildRequestContext<A extends string>(
  action: A,
  input: RequestContextInput & { bppId: string; bppUri: string },
): OndcContext & { action: A; bpp_id: string; bpp_uri: string; ttl: string };
export function buildRequestContext<A extends string>(
  action: A,
  input: RequestContextInput,
): OndcContext & { action: A; ttl: string };
export function buildRequestContext(action: string, input: RequestContextInput) {
  return {
    domain: input.base.domain,
    country: input.base.country,
    city: input.base.city,
    action,
    core_version: input.base.core_version,
    bap_id: input.base.bap_id,
    bap_uri: input.base.bap_uri,
    ...(input.bppId !== undefined ? { bpp_id: input.bppId } : {}),
    ...(input.bppUri !== undefined ? { bpp_uri: input.bppUri } : {}),
    transaction_id: input.transactionId,
    message_id: input.messageId ?? randomUUID(),
    timestamp: input.timestamp ?? new Date().toISOString(),
    ttl: input.ttl ?? DEFAULT_REQUEST_TTL,
  };
}

// ─── Inbound callback context validation ─────────────────────────────────────

export class OndcContextError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path} ${message}`);
    this.name = "OndcContextError";
  }
}

export interface CallbackContextExpectation {
  action: string;
  /** Exact match required when set (core logistics callbacks). */
  domain?: string;
  coreVersion?: string;
  /** Our own subscriber id — callbacks addressed to anyone else are rejected. */
  bapId?: string;
  /** Accept a missing context.city (IGM callbacks); a present city is still format-checked. */
  cityOptional?: boolean;
}

const COUNTRY = /^[A-Z]{3}$/;
const CITY = /^(std:\d{2,6}|\*)$/;
const RFC3339 =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
const ISO_DURATION =
  /^P(?!$)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+(\.\d+)?S)?)?$/;

const requireString = (c: Record<string, unknown>, key: string): string => {
  const value = c[key];
  if (typeof value !== "string" || value.trim() === "")
    throw new OndcContextError(`context.${key}`, "is required");
  return value;
};

const requireUrl = (c: Record<string, unknown>, key: string) => {
  const value = requireString(c, key);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OndcContextError(`context.${key}`, "must be a valid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new OndcContextError(`context.${key}`, "must be an http(s) URL");
};

const requireEqual = (
  c: Record<string, unknown>,
  key: string,
  expected: string | undefined,
) => {
  const value = requireString(c, key);
  if (expected && value !== expected)
    throw new OndcContextError(`context.${key}`, `must be "${expected}"`);
};

/**
 * Validates every context field of an inbound callback. Throws
 * OndcContextError naming the first offending field.
 */
export const validateCallbackContext = (
  body: unknown,
  expected: CallbackContextExpectation,
): OndcContext => {
  const raw = (body as { context?: unknown } | undefined)?.context;
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new OndcContextError("context", "is required");
  const c = raw as Record<string, unknown>;

  requireEqual(c, "action", expected.action);
  requireEqual(c, "domain", expected.domain);
  if (!COUNTRY.test(requireString(c, "country")))
    throw new OndcContextError("context.country", "must be an ISO 3166-1 alpha-3 code");
  const cityMissing =
    c.city === undefined || (typeof c.city === "string" && c.city.trim() === "");
  if (!(expected.cityOptional && cityMissing) && !CITY.test(requireString(c, "city")))
    throw new OndcContextError("context.city", 'must be "std:<STD code>" or "*"');
  requireEqual(c, "core_version", expected.coreVersion);
  requireEqual(c, "bap_id", expected.bapId);
  requireUrl(c, "bap_uri");
  requireString(c, "bpp_id");
  requireUrl(c, "bpp_uri");
  requireString(c, "transaction_id");
  requireString(c, "message_id");
  const timestamp = requireString(c, "timestamp");
  if (!RFC3339.test(timestamp) || Number.isNaN(Date.parse(timestamp)))
    throw new OndcContextError("context.timestamp", "must be an RFC 3339 date-time");
  if (c.ttl !== undefined) {
    if (typeof c.ttl !== "string" || !ISO_DURATION.test(c.ttl))
      throw new OndcContextError("context.ttl", "must be an ISO 8601 duration");
  }
  return c as unknown as OndcContext;
};
