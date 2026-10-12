# Log registry response on signing-key lookup miss

**Date:** 2026-10-12
**Type:** fix

## What changed

`lookupSigningPublicKey` (src/services/registry.service.ts) now logs an
ERROR (`[registry]`) whenever it returns null:

- HTTP 404 → subscriber_id, ukId, registry URL, status.
- 200 array with no usable record → record count and, for up to 10 records,
  subscriber_id / ukId / status / validity window / whether a signing key is
  present.
- 200 non-array body → the body itself, truncated to 400 chars.

No public keys or our Authorization header are logged.

## Why

A live `/on_search` from `workbench.ondc.tech` was NACKed with "no usable
signing key in registry", but the same lookup made locally afterwards
returned the key. Nothing recorded what the registry had actually returned.
While verifying the fix we found the registry answers "not registered" with
HTTP 200 plus a NACK body (e.g. `15045 No matching network participant
found`), not a 404, so that body is now logged as-is.

## Files

- src/services/registry.service.ts

## API/contract impact

None. Logging only; behaviour and the response sent back are unchanged.

## Validation

- `npx tsc --noEmit -p .` — clean.
- Scratchpad script against the preprod registry: the real workbench ukId
  returns the key and logs nothing; a bogus ukId logs the miss with the
  registry's `15045` NACK body and returns null.
