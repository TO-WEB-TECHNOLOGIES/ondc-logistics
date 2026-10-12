import type { NextFunction, Request, Response } from "express";
import {
  parseAuthorizationHeader,
  verifyAuthorizationHeader,
} from "../utils/crypto.js";
import {
  lookupSigningPublicKey,
  RegistryUnavailableError,
} from "../services/registry.service.js";
import {
  ONDC_INTERNAL_ERROR_HTTP_STATUS,
  ondcInternalErrorNack,
  ondcNack,
  syncResponseContext,
} from "../utils/ondc-error-response.js";
import { logger } from "../utils/logger.js";

/** Same code ondc-api uses for "BNP | Invalid Signature"; the contract itself only mandates http 401. */
const INVALID_SIGNATURE_CODE = "20001";

/** Correlation ids from the (possibly array-wrapped) callback context. */
const contextIds = (body: unknown) => {
  const source = Array.isArray(body) ? body[0] : body;
  const context = (source as { context?: Record<string, unknown> } | undefined)?.context;
  return {
    bpp_id: context?.bpp_id,
    transactionId: context?.transaction_id,
    messageId: context?.message_id,
  };
};

/**
 * Runs first on every inbound /on_* callback (before callbackContextMiddleware):
 * verifies the `Authorization: Signature ...` header against the sender's
 * registry signing_public_key, hashing the exact raw body bytes (req.rawBody).
 *
 * Contract ("Signing & Verification"): every request must be verified by the
 * receiver; on failure NACK with http 401. The keyId's subscriber_id must also
 * be the callback's context.bpp_id, so one registered BPP can't sign callbacks
 * on another's behalf. A registry outage is our internal error, so it returns
 * the retriable 503/63001 NACK instead of 401.
 */
export const verifyOndcSignature =
  (action: string) =>
  async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    const ids = { action, ...contextIds(request.body) };

    const reject = (reason: string, extra: Record<string, unknown> = {}) => {
      logger.error("ondc-signature", `${action} rejected — ${reason}.`, { ...ids, ...extra });
      response.status(401).json({
        ...syncResponseContext(request.body),
        ...ondcNack({
          type: "DOMAIN-ERROR",
          code: INVALID_SIGNATURE_CODE,
          message: `Cannot verify signature: ${reason}`,
        }),
      });
    };

    try {
      const authHeader = request.headers.authorization;
      if (!authHeader) return reject("missing Authorization header");

      const header = parseAuthorizationHeader(authHeader);
      if (!header) return reject("malformed Authorization header");

      const rawBody: Buffer | undefined = (request as any).rawBody;
      if (!rawBody || rawBody.length === 0) return reject("empty request body");

      if (header.subscriberId !== ids.bpp_id)
        return reject("keyId subscriber_id does not match context.bpp_id", {
          keyId: header.keyId,
        });

      const publicKey = await lookupSigningPublicKey(header.subscriberId, header.ukId);
      if (!publicKey)
        return reject("no usable signing key in registry", { keyId: header.keyId });

      const result = await verifyAuthorizationHeader({ header, rawBody, publicKeyBase64: publicKey });
      if (!result.valid) return reject(result.reason, { keyId: header.keyId });

      next();
    } catch (error) {
      if (error instanceof RegistryUnavailableError) {
        logger.error("ondc-signature", `${action} not verified — registry unavailable; NACK 63001 (retriable).`, {
          ...ids,
          error: error.message,
        });
        response
          .status(ONDC_INTERNAL_ERROR_HTTP_STATUS)
          .json(ondcInternalErrorNack(request.body));
        return;
      }
      next(error);
    }
  };
