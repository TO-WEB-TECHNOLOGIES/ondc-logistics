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
