import axios from "axios";
import { REGISTRY_URL } from "../constants/v1/appConstants.js";
import { createAuthorizationHeader } from "../utils/crypto.js";

/**
 * Registry lookup of a sender's signing_public_key, used to verify inbound
 * ONDC signatures (contract: "Auth Header Verification" / "Registry lookup
 * for verifying requests"). The contract allows caching the registry locally.
 *
 * Uses plain axios rather than utils/v1/axios.ts `api`: that instance's
 * interceptors push every call to the Network Observability API, and a
 * registry lookup is not a transaction-log event.
 */

const KEY_CACHE_TTL_MS = 30 * 60 * 1000;
const LOOKUP_TIMEOUT_MS = 10_000;
const keyCache = new Map<string, { key: string; expiresAt: number }>();

/** The registry could not be queried (network/5xx/auth) — retriable, not a bad signature. */
export class RegistryUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistryUnavailableError";
  }
}

type RegistryRecord = {
  subscriber_id?: string;
  ukId?: string;
  unique_key_id?: string;
  status?: string;
  valid_from?: string;
  valid_until?: string;
  signing_public_key?: string;
};

const isUsable = (record: RegistryRecord, now: number): boolean => {
  if (!record.signing_public_key) return false;
  if (record.status !== undefined && record.status !== "SUBSCRIBED") return false;
  if (record.valid_from && Date.parse(record.valid_from) > now) return false;
  if (record.valid_until && Date.parse(record.valid_until) < now) return false;
  return true;
};

/**
 * Returns the sender's base64 signing_public_key for (subscriber_id, ukId),
 * or null when the registry has no usable matching record. Throws
 * RegistryUnavailableError when the registry itself can't be reached.
 * Misses are not cached, so a newly registered key is picked up immediately.
 */
export const lookupSigningPublicKey = async (
  subscriberId: string,
  ukId: string,
): Promise<string | null> => {
  const cacheKey = `${subscriberId}|${ukId}`;
  const cached = keyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.key;

  const payload = { subscriber_id: subscriberId, ukId };
  let data: unknown;
  try {
    const response = await axios.post("v2.0/lookup", payload, {
      baseURL: REGISTRY_URL,
      timeout: LOOKUP_TIMEOUT_MS,
      headers: {
        "Content-Type": "application/json",
        Authorization: await createAuthorizationHeader({ payload }),
      },
    });
    data = response.data;
  } catch (error: any) {
    if (error?.response?.status === 404) return null;
    const status = error?.response?.status;
    throw new RegistryUnavailableError(
      `registry lookup failed${status ? ` (http ${status})` : ""}: ${error?.message ?? String(error)}`,
    );
  }

  const records: RegistryRecord[] = Array.isArray(data)
    ? data
    : data && typeof data === "object"
      ? [data as RegistryRecord]
      : [];
  const now = Date.now();
  const match = records.find(
    (r) =>
      r.subscriber_id === subscriberId &&
      (r.ukId === ukId || r.unique_key_id === ukId) &&
      isUsable(r, now),
  );
  if (!match?.signing_public_key) return null;

  keyCache.set(cacheKey, {
    key: match.signing_public_key,
    expiresAt: now + KEY_CACHE_TTL_MS,
  });
  return match.signing_public_key;
};
