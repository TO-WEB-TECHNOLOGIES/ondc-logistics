# Contract-shaped sync responses for /on_init and /on_confirm

**Date:** 2026-09-25
**Type:** fix

## What changed

- Added `ondcAck(body)` and `ondcInternalErrorNack(body)` (+
  `ONDC_INTERNAL_ERROR_HTTP_STATUS = 503`) to `src/utils/ondc-error-response.ts`.
  Both echo the callback's `context` like the existing `syncResponseContext`.
- `/on_confirm`: the ACK was sent synchronously before `handleCallback`
  resolved, so the `not_found` / `invalid_order` / `invalid_bpp` NACKs tried
  to write a second response (`ERR_HTTP_HEADERS_SENT`). The ACK is now sent
  from `.then` after processing, so exactly one response goes out, and only
  after the order is persisted.
- `/on_init` and `/on_confirm`: processing failures and unexpected errors
  previously returned HTTP 500 with a non-ONDC body
  (`{ error: { code: "ON_*_FAILED" } }`, no `context`, no `message.ack`). They
  now return HTTP 503 with `context` + `message.ack.status = "NACK"` +
  `error { type: "CORE-ERROR", code: "63001" }`.
- Removed the `BEFORE RESPONSE` / `AFTER RESPONSE` debug logs in
  `/on_confirm`.

## Why

The Pramaan cancellation report flagged `on_init` / `on_confirm` sync
responses without `context` in one Buyer run. The success path already
echoed `context` since `ec4bebc`; the failing run matches the pre-`ec4bebc`
body and most likely hit an older Render deployment. This change closes the
remaining paths that could still produce a context-less or double response.

## Files

- src/utils/ondc-error-response.ts
- src/controllers/init.controller.ts
- src/controllers/confirm.controller.ts

## API/contract impact

- ACK body unchanged: `{ context, message: { ack: { status: "ACK" } } }`,
  per the contract's `/on_search` ACK response sample.
- Internal-error responses now follow the contract's "Rules for order
  confirmation": LBNP NACKs internal errors with http 503/504 and retriable
  code 63001. The contract states this for `/on_confirm`; it is applied to
  `/on_init` as well. `error.type = "CORE-ERROR"` is our choice (the
  contract gives no sample for this case).
- `/on_confirm` ACK is now sent after persistence, which adds the DB
  processing time to the sync response latency.

## Validation

- `npx tsc --noEmit -p .` → exit 0.
- Printed `ondcAck` / `ondcInternalErrorNack` output for a sample
  `/on_confirm` body via `npx tsx`: context echoed, ACK/NACK + error shaped
  as above.
- Not run: live `/on_init` / `/on_confirm` against a server, Pramaan re-run.
