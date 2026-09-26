# Transaction-consistent context + stricter /on_init correlation

**Date:** 2026-09-26
**Type:** fix

## What changed

- The static ONDC protocol config (domain/country/city/core_version/bap_id/bap_uri/ttl) now lives in one place, `src/config/ondc-protocol.ts`, instead of being duplicated in `ondc.routes.ts` and `issue.routes.ts`. The env names and defaults are unchanged.
- New `src/repositories/transaction-context.ts`. It loads a transaction's stored `/search` context from `ondc_transactions` and merges it over the static protocol.
- `/init`, `/status`, `/track`, `/cancel` and `/update` now send the `domain`, `country`, `city` and `core_version` stored on the transaction's `/search` row. Previously they sent the `ONDC_CITY` env default. `/confirm` already did this via the stored `/init` row, so it is unchanged.
- `/issue`, `/issue` updates and `/issue_status` take only `city` and `country` from the transaction. IGM keeps its configured `domain` and `core_version`.
- Any missing stored value falls back to the static protocol.
- `/on_init` now matches on `(transaction_id, action='init', message_id)` instead of `(transaction_id, action)` with `LIMIT 1`.
- `/on_init` now NACKs a `bpp_id` that differs from the one `/init` was sent to, with `CONTEXT-ERROR 63002`. This is the same pattern `/on_confirm` uses.

## Why

- A `/search` whose city came from the request (`request.protocol.city`) was followed by `/init` and post-order calls carrying a different city (`std:080`). LSPs can reject that as an inconsistent context.
- A transaction can hold several `/init` rows, one per re-init. The old `/on_init` lookup could apply a callback to the wrong row, and it never checked the sender's `bpp_id`.

## Files

- src/config/ondc-protocol.ts (new)
- src/repositories/transaction-context.ts (new)
- src/routes/ondc.routes.ts
- src/routes/issue.routes.ts
- src/services/init.service.ts
- src/services/status.service.ts
- src/services/track.service.ts
- src/services/cancel.service.ts
- src/services/update.service.ts
- src/services/issue.service.ts
- src/repositories/init.repository.ts
- src/controllers/init.controller.ts

## API/contract impact

- No change to the shape of any wire payload. Only the value of `context.city` (and of domain/country/core_version, if they ever differed from env) now follows the transaction's `/search`.
- New NACK on `/on_init`: an unknown `message_id` gets the existing `20004`, and a `bpp_id` mismatch gets `63002`.
- No DB schema, migration or Redis changes.

## Validation

- `npx tsc --noEmit -p .` passes with exit code 0, before and after the change.
- No flow run yet.
