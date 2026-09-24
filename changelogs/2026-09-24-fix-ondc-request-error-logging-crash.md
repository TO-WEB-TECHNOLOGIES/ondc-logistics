# Fix crash in outbound ONDC request error logging

**Date:** 2026-09-24
**Type:** fix

## What changed

`src/utils/ondc-requests.ts`'s `sendOndcRequest` catch block unconditionally
ran `console.log(err.response.data)`. When the outbound POST to the ONDC
gateway/BPP fails without an HTTP response (timeout, DNS failure, connection
refused, TLS error, etc.), axios's error has `err.response === undefined`,
so reading `.data` off it threw a new `TypeError: Cannot read properties of
undefined (reading 'data')` — replacing the real underlying error before it
could reach the caller. Changed to
`console.log(err?.response?.data ?? err?.message ?? err)`.

## Why

This was discovered while testing the `/logistics/search` fix
(`changelogs/2026-09-24-search-payment-schedule-gps-fix.md`): the cancellation
flow's search step failed with exactly this masked TypeError even though the
request payload had already been built and logged correctly. The real cause
of the outbound POST failure was hidden by this bug. Fixing it doesn't fix
the underlying gateway/network issue (if one exists) but is required to see
what it actually is. Affects every outbound action (search/init/confirm/
update/status/track/cancel/issue), not just search.

## Files

- `src/utils/ondc-requests.ts`

## API/contract impact

None — logging-only change; `throw err` still re-throws the original error
afterward, so caller-facing error behavior (400/500 responses) is unchanged.

## Validation

- `npx tsc --noEmit -p .` — passes with no errors.
- Not yet re-run against the live gateway — next step is to re-run the
  cancellation flow so the real (previously masked) error can be diagnosed.
