# Update cancellation flow's search step to send full payload

**Date:** 2026-09-24
**Type:** task

## What changed

Updated the shared `runSearchInitConfirm()` helper in `src/flows/flow-kit.ts`
(used by every workbench flow script, including
`ondc-buyer-cancellation.flow.ts`) so the `/logistics/search` call it sends
matches what the backend now accepts and the ONDC contract requires:

- `start.gps`/`end.gps` changed from 4 decimal digits (`"28.9845,77.7064"`,
  `"28.6139,77.2090"`) to 6 (`"28.984500,77.706400"`,
  `"28.613900,77.209000"`) — same coordinates, correct precision.
- `schedule` now also sends `duration: "PT30M"` and
  `holidays: ["2026-01-26", "2026-08-15"]`.
- Added a new `payment: { type: "POST-FULFILLMENT", collection_amount:
  "300.00" }` block.

## Why

These fields were missing/malformed on the `/search` request the flow
script sends, which is exactly what the Pramaan cancellation cert run
flagged as the 11 "search request verification" failures in
`tasks/cancellation.md`. See
`changelogs/2026-09-24-search-payment-schedule-gps-fix.md` for the
corresponding backend parsing/mapping fix that makes these fields actually
reach the outbound ONDC payload.

Filed here in `changelogs/local/` rather than the root `changelogs/`
(where `src/flows/*` normally goes per `CLAUDE.md` §13) per explicit
instruction for this task — the split for this task is "flow script
changes" vs. "main code changes", not tracked vs. gitignored.

## Files

- `src/flows/flow-kit.ts`

## Validation

- `npx tsc --noEmit -p .` — passes with no errors (run together with the
  backend change in the same pass).
- Not re-run against the live deployed service / Pramaan suite in this
  session — next step is `npm run flow:cancellation` against the deployed
  backend once this change ships, then a fresh Pramaan cert run to confirm
  the search failures clear.
