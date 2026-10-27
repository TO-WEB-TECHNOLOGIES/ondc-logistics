# NO API: fall back to request context for context-less ACK/NACK

**Date:** 2026-10-27
**Type:** fix

## What changed

- `src/utils/v1/axios.ts`: in the response and error interceptors, the
  `<action>_response` Network Observability push now uses the context of the
  request we sent when the counterparty's ACK/NACK body has no
  `context.action`. The request `config.data` is already a JSON string at that
  point, so it is parsed first. If the ACK has its own context, it is used
  as before.

## Why

LSPs that ACK with only `{ message: { ack } }` produced NO pushes with
`context: {}`. The NO API rejected those with 400 `"data.context.action must be
a string"` (seen for `init_response`), so the `*_response` entries were missing
from ONDC's observability trail.

## Files

- src/utils/v1/axios.ts

## API/contract impact

None. Only the payload sent to the NO API changes; ONDC wire traffic is
unaffected.

## Validation

- `npx tsc --noEmit`: passed.
- `npm run build`: passed.
- Not exercised end to end. Running the interceptor would push real logs to
  the NO API. Check the next `init_response` push in PREPROD logs
  (`NO API request payload`).
