# Verify ONDC signatures on inbound callbacks

**Date:** 2026-10-12
**Type:** feature

## What changed

- New `verifyOndcSignature(action)` middleware runs first on all 9 inbound
  callbacks (`/on_search`, `/on_init`, `/on_confirm`, `/on_update`,
  `/on_status`, `/on_track`, `/on_cancel`, `/on_issue`, `/on_issue_status`),
  before `callbackContextMiddleware`.
- Checks: `Authorization` present and parseable; `keyId` subscriber_id equals
  `context.bpp_id`; registry has a usable key (matching subscriber_id + ukId,
  `status` SUBSCRIBED when present, within `valid_from`/`valid_until`);
  `algorithm` = ed25519, `headers` = `(created) (expires) digest`; `created`
  not more than 60s in the future; not expired; ed25519 verify of the
  BLAKE2b-512 digest over the exact raw body bytes (`req.rawBody`).
- Failure → HTTP 401 NACK (`DOMAIN-ERROR` / `20001`, context echoed).
  Registry unreachable → HTTP 503 NACK `63001` (retriable).
- `src/services/registry.service.ts`: `POST {REGISTRY_URL}v2.0/lookup`
  (signed with our key, plain axios so it's not pushed to the NO API),
  30-minute in-memory cache of hits; misses are not cached.
- `src/utils/crypto.ts`: `parseAuthorizationHeader`, `verifyAuthorizationHeader`.

Ported from ondc-api's `ondc-signature.middleware.ts` / `registry.service.ts`,
without its staging↔preprod subscriber_id swap, and with the added bpp_id
binding, registry-record validity and algorithm/headers/created checks.

## Why

Callbacks were accepted without any signature verification. Contract
("Signing & Verification"): all requests must be verified by the receiver
and rejected with http 401 on failure.

## Files

- src/middlewares/ondc-signature.middleware.ts (new)
- src/services/registry.service.ts (new)
- src/utils/crypto.ts
- src/routes/ondc.routes.ts
- src/routes/issue.routes.ts

## API/contract impact

No outbound payload change. Unsigned or invalidly signed inbound callbacks
now get a 401 NACK; manual Postman/curl calls to `/on_*` need valid signatures.
`20001` is not listed in the logistics contract (it only mandates http 401).

## Validation

- `npx tsc --noEmit -p .` — clean.
- Scratchpad round-trip script (fresh ed25519 key pair): valid → valid;
  tampered body, re-stringified body (escaped `\/` / `é` lost),
  expired, future `created`, wrong algorithm → rejected; malformed header →
  parse null.
- Not run: live registry lookup / real LSP callback end-to-end.
