import {
  SIGNING_PRIVATE_KEY,
  SUBSCRIBER_ID,
  UNIQUE_KEY_ID,
} from "../constants/v1/appConstants.js";
import _sodium from "libsodium-wrappers";

export const initializeCrypto = async () => {
  await _sodium.ready;
  return _sodium;
};

/**
 * Creates the Authorization Header for an ONDC request.
 *
 * Signs with this NP's own key material — always SIGNING_PRIVATE_KEY/SUBSCRIBER_ID/
 * UNIQUE_KEY_ID from appConstants.ts, never per-call values (every caller across the
 * codebase was already passing these exact same 3 static constants through). Read
 * directly here instead, so callers only need to supply the payload being signed.
 */
export const createAuthorizationHeader = async ({
  payload,
}: {
  payload: any;
}): Promise<string> => {
  const sodium = await initializeCrypto();
  const privateKeyBase64 = SIGNING_PRIVATE_KEY;
  const subscriberId = SUBSCRIBER_ID;
  const uniqueKeyId = UNIQUE_KEY_ID;

  // 1. Generate UTF-8 byte array from json payload
  const payloadString =
    typeof payload === "string" ? payload : JSON.stringify(payload);
  const payloadBytes = sodium.from_string(payloadString);

  // 2. Generate Blake2b-512 hash from UTF-8 byte array
  const hashBytes = sodium.crypto_generichash(64, payloadBytes, null);

  // 3. Create base64 encoding of Blake2b hash
  const digestBase64 = sodium.to_base64(
    hashBytes,
    sodium.base64_variants.ORIGINAL,
  );
  const digestStr = `BLAKE-512=${digestBase64}`;

  // 4. Create signing string
  const created = Math.floor(Date.now() / 1000);
  const expires = created + 1 * 60 * 60; // 1 hour expiry

  const signingString = `(created): ${created}\n(expires): ${expires}\ndigest: ${digestStr}`;

  // 5. Sign the string using the private key
  const privateKeyBytes = sodium.from_base64(
    privateKeyBase64,
    sodium.base64_variants.ORIGINAL,
  );
  const signatureBytes = sodium.crypto_sign_detached(
    sodium.from_string(signingString),
    privateKeyBytes,
  );
  const signatureBase64 = sodium.to_base64(
    signatureBytes,
    sodium.base64_variants.ORIGINAL,
  );

  // 6. Create the Authorization Header
  const keyId = `${subscriberId}|${uniqueKeyId}|ed25519`;
  const header = `Signature keyId="${keyId}",algorithm="ed25519",created="${created}",expires="${expires}",headers="(created) (expires) digest",signature="${signatureBase64}"`;

  return header;
};

/** Fixed across the network per the contract's signing scheme; not sender-negotiable. */
const SIGNATURE_ALGORITHM = "ed25519";
const SIGNATURE_HEADERS = "(created) (expires) digest";
/** Tolerated clock drift for a sender's `created` timestamp. */
const CREATED_CLOCK_SKEW_SECONDS = 60;

export type ParsedAuthorizationHeader = {
  keyId: string;
  subscriberId: string;
  ukId: string;
  algorithm: string;
  created: string;
  expires: string;
  headers: string;
  signature: string;
};

/**
 * Parses `Signature keyId="sub|ukId|ed25519",algorithm=..,created=..,expires=..,headers=..,signature=..`.
 * Returns null when the header is malformed or any required parameter is missing.
 */
export const parseAuthorizationHeader = (
  header: string,
): ParsedAuthorizationHeader | null => {
  const match = header.match(/^\s*Signature\s+(.*)$/s);
  if (!match) return null;

  const params: Record<string, string> = {};
  // Split on commas outside quotes.
  for (const part of match[1].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/)) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    let value = trimmed.substring(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    params[trimmed.substring(0, eq).trim()] = value;
  }

  const { keyId, algorithm, created, expires, headers, signature } = params;
  if (!keyId || !algorithm || !created || !expires || !headers || !signature) return null;

  // keyId = "{subscriber_id}|{unique_key_id}|{algorithm}"
  const [subscriberId, ukId] = keyId.split("|");
  if (!subscriberId || !ukId) return null;

  return { keyId, subscriberId, ukId, algorithm, created, expires, headers, signature };
};

export type SignatureCheck =
  | { valid: true }
  | { valid: false; reason: string };

/**
 * Verifies an inbound ONDC Authorization header against the sender's registry
 * signing_public_key: BLAKE2b-512 digest of the EXACT raw body bytes (req.rawBody,
 * see src/index.ts) → signing string → ed25519 detached verify.
 */
export const verifyAuthorizationHeader = async ({
  header,
  rawBody,
  publicKeyBase64,
}: {
  header: ParsedAuthorizationHeader;
  rawBody: Buffer;
  publicKeyBase64: string;
}): Promise<SignatureCheck> => {
  if (header.algorithm !== SIGNATURE_ALGORITHM)
    return { valid: false, reason: `unsupported algorithm "${header.algorithm}"` };
  if (header.headers !== SIGNATURE_HEADERS)
    return { valid: false, reason: `unexpected signed headers "${header.headers}"` };

  const created = Number(header.created);
  const expires = Number(header.expires);
  if (!Number.isInteger(created) || !Number.isInteger(expires))
    return { valid: false, reason: "created/expires are not integer timestamps" };
  const now = Math.floor(Date.now() / 1000);
  if (created > now + CREATED_CLOCK_SKEW_SECONDS)
    return { valid: false, reason: "created is in the future" };
  if (now > expires) return { valid: false, reason: "signature expired" };

  const sodium = await initializeCrypto();
  try {
    const hashBytes = sodium.crypto_generichash(64, new Uint8Array(rawBody), null);
    const digestStr = `BLAKE-512=${sodium.to_base64(hashBytes, sodium.base64_variants.ORIGINAL)}`;
    const signingString = `(created): ${header.created}\n(expires): ${header.expires}\ndigest: ${digestStr}`;

    const ok = sodium.crypto_sign_verify_detached(
      sodium.from_base64(header.signature, sodium.base64_variants.ORIGINAL),
      sodium.from_string(signingString),
      sodium.from_base64(publicKeyBase64, sodium.base64_variants.ORIGINAL),
    );
    return ok ? { valid: true } : { valid: false, reason: "signature mismatch" };
  } catch (error) {
    return { valid: false, reason: `malformed signature or key: ${(error as Error).message}` };
  }
};
