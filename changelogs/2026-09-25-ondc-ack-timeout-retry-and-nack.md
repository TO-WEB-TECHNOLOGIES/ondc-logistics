# Outbound ONDC requests: 15s ACK timeout with same-transaction retries; stop on NACK

**Date:** 2026-09-25
**Type:** feature

## What changed

- `sendOndcRequest` (`src/utils/ondc-requests.ts`) now waits at most `ONDC_ACK_TIMEOUT_MS`
  (default 15000) per attempt for the counterparty's sync ACK/NACK. The axios request is aborted
  on timeout.
- If an attempt times out, gets no response, or gets HTTP 503/504, the request is re-sent up to
  `ONDC_ACK_RETRIES` (default 2) more times with the **same transaction_id, message_id and
  body**. Each retry gets a fresh `context.timestamp` (so it isn't treated as stale, 65003) and a
  new signature. The request is still persisted once, by the caller, before the first attempt.
  There's a 1s pause before retries that failed fast; a timeout retries immediately.
- A sync **NACK** in the response body (on HTTP 200 as well as error statuses) now throws
  `OndcNackError`. Before this it was treated as success. NACKs are not retried, except NACK
  `66001` on `/confirm`, which the contract ("Rules for order confirmation") marks retriable.
- When every attempt fails retriably, `OndcAckTimeoutError` is thrown.
- `ondcSubmissionFailure()` in `src/utils/ondc-error-response.ts` maps those two errors to HTTP 502
  `{ error: { code: "ONDC_NACK" | "ONDC_ACK_TIMEOUT", message, details: [...] } }`. NACK details
  carry `ondcType/ondcCode/ondcMessage/ondcPath/httpStatus/attempts`. Every `/logistics/*`
  request controller (search, init, confirm, update, status, track, cancel, issue ×2,
  issue_status) checks it before its existing error mapping. Other errors are unchanged.
- The new constants `ONDC_ACK_TIMEOUT_MS` and `ONDC_ACK_RETRIES` live in
  `src/constants/v1/appConstants.ts` and are read from env. `.env` was not changed.
- `src/flows/flow-kit.ts`:
  - `ONDC_NACK` and `ONDC_ACK_TIMEOUT` are never retried client-side, so the flow stops.
  - The failure box shows an `ondc` row (type — code — message) for a NACK.
  - The hints were rewritten for both codes. The old "took ~30s → axios timeout" heuristic and
    `OUTBOUND_TIMEOUT_MS` were removed.
  - The header and `settle()` comments now say that callback events already arrive after the
    server's ACK and that `FLOW_STEP_DELAY_MS` is just an extra pause.

## Why

The flows should behave like Postman: send, wait for the ACK, wait for the callback, then
continue, and stop as soon as the workbench NACKs. Before this, a workbench NACK came back as
202 (the flow then waited for a callback that never came), and a slow workbench held the request
for 30s with no retry.

## Files

- src/utils/ondc-requests.ts
- src/utils/ondc-error-response.ts
- src/constants/v1/appConstants.ts
- src/controllers/{search,init,confirm,update,status,track,cancel,issue}.controller.ts
- src/flows/flow-kit.ts

## API/contract impact

- ONDC wire: a retry is the same payload with the same transaction_id/message_id; only
  `context.timestamp` and the `Authorization` signature differ. The contract identifies a request
  by transaction_id + message_id and allows NACKing an older timestamp as stale (65003). It does
  not explicitly say a retry must reuse message_id; that is our interpretation.
- Internal API: `/logistics/*` now returns 502 `ONDC_NACK` / `ONDC_ACK_TIMEOUT` where it used to
  return 202 (NACK) or a generic 502/500 (timeout). A request can now take up to
  ~(1 + ONDC_ACK_RETRIES) × ONDC_ACK_TIMEOUT_MS + backoff (≈47s with the defaults).
- Risk: if the workbench's ACK was slow rather than lost, it receives a duplicate request.
- Not implemented: the contract's "cancel with reason 996 if /confirm gets no ACK after
  retries". It's reported as `ONDC_ACK_TIMEOUT` only.

## Validation

- `npx tsc --noEmit -p .` → exit 0
- Scratchpad `tsx` script against a local fake counterparty (`ONDC_ACK_TIMEOUT_MS=500`,
  `ONDC_ACK_RETRIES=2`, `NO_ANALYTICS_TOKEN` empty so nothing went to the NO API):
  - ACK → 1 attempt
  - never answers → 3 attempts, `ONDC_ACK_TIMEOUT` 502
  - timeout then ACK → 2 attempts, success
  - NACK 60001 → 1 attempt, `ONDC_NACK` 502
  - 503 then ACK → 2 attempts, success
  - NACK 66001 → retried on `/confirm`, not on `/init`
  - every attempt kept message_id `M1` and was signed; retries had fresh timestamps
- Not yet run: a live `npm run flow:*` against the deployed service
