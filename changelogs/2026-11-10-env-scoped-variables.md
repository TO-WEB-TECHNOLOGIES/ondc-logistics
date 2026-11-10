# ENV-scoped env vars (PREPROD_* / PROD_*)

**Date:** 2026-11-10
**Type:** feature

## What changed

- New `src/config/env.ts`:
  - `ENV` is now parsed case-insensitively. Anything that isn't `PROD` or `PREPROD` logs a warning and falls back to `PREPROD`.
  - `envFor(name)` returns `${ENV}_<name>` when it is set and non-blank, otherwise plain `<name>`.
  - `envForFirst(...names)` checks every scoped name before any plain name.
  - `envSourceSummary()` lists which variable each value came from (names only, never values).
- Values now read through `envFor`:
  - `SIGNING_*`, `ENCRYPTION_*`, `UNIQUE_KEY_ID`, `SUBSCRIBER_ID`, `BFF`, `NO_ANALYTICS_TOKEN`, `REGISTRY_URL`, `GATEWAY_URL` (`appConstants.ts`).
  - `ONDC_*`, `BAP_ID`, `BAP_URI` (`ondc-protocol.ts`).
  - The init `bapUri` (`ondc.routes.ts`).
  - `NO_ANALYTICS_TOKEN_LAST_UPDATED` (`network-observability.service.ts`).
  - `BAP_SUPPORT_*` (`issue.mapper.ts`).
  - `BASE_URL` (`flow-kit.ts`).
- DB URL used by pool1, poolIngest and poolWebhook: `${ENV}_PSQL_URI`, then `${ENV}_DATABASE_URL`, then `PSQL_URI`, then `DATABASE_URL`, then the localhost default. `PSQL_URI_AUTH` goes through `envFor`.
- Startup logs `ENV=<env> — env sources: ...` after the server starts listening.
- `REGISTRY_URL` and `GATEWAY_URL` behave the same as before: `PROD_` or `PREPROD_` value, then the hard-coded default. There is now also a plain-name fallback.

## Why

The `PREPROD_*` variables (`PREPROD_DATABASE_URL`, `PREPROD_BAP_ID`, `PREPROD_SIGNING_*`, etc.) were never read. Every setting used the plain variable whatever `ENV` was set to.

## Files

- src/config/env.ts (new)
- src/constants/v1/appConstants.ts
- src/config/ondc-protocol.ts
- src/routes/ondc.routes.ts
- src/db/index.ts
- src/services/network-observability.service.ts
- src/mappers/issue.mapper.ts
- src/flows/flow-kit.ts
- src/index.ts

## API/contract impact

None to the wire format. Values for `bap_id`, `bap_uri`, `subscriber_id`, `ukId` and the signing keys now come from the ENV-scoped variable when it is set.
Risk: a missing scoped key falls back to the plain key. If the plain key belongs to the other environment, signatures fail the registry lookup. Check the startup source line.

## Validation

- `npx tsc --noEmit -p .`: exit 0.
- Ran `envFor` / `envForFirst` with `tsx` and dummy variables:
  - With `ENV=preprod`, the scoped value is chosen and `PREPROD_X_B` beats plain `X_A`.
  - With `ENV=PROD`, it falls back to the plain value.
