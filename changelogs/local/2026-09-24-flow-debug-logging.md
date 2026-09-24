# Debug logging for workbench flow scripts (with kill switch)

**Date:** 2026-09-24
**Type:** flow-script

## What changed

- `src/flows/flow-kit.ts` gained debug diagnostics, controlled by the `FLOW_DEBUG` env var:
  - `off` / `0` / `false`: plain step logs only (debug disabled)
  - unset (default): compact debug
    - timestamps and time since flow start on every line
    - every SSE event logged with its correlation ids (transactionId, messageId, orderId, state…)
    - events nobody is waiting for flagged as "buffered, not awaited"
    - 30s "still waiting" heartbeats that list buffered events
    - request timings and response ids
    - raw text logged when a response isn't JSON
  - `full` / `1` / `true`: all of the above, plus full request/response/event payloads, pretty-printed
- On failure (unless `off`) the kit prints the failed step, clientId, elapsed time, stack trace, unconsumed events and the last 20 SSE events. It also writes a JSON dump (transcript of requests, responses and events) to `reports/flow-runs/<flow>-<timestamp>.json`, which is gitignored.
- Robustness, regardless of the `FLOW_DEBUG` setting:
  - Network errors now include step, path and duration.
  - Invalid SSE JSON is logged instead of crashing the reader.
  - A stream close or read error reports the failure context.
  - `on_search` with no provider or usable item throws a descriptive error instead of a TypeError.
  - `unhandledRejection` is routed to the failure report.
- `src/flows/ondc-baseline-igm.flow.ts` now uses the shared kit (`runFlow`, `runSearchInitConfirm`, `post`, `waitFor`, `waitForCount`). Its duplicated helpers were removed. Its step 7–19 request bodies are unchanged.

## Why

Flows were failing repeatedly with little context. A wrong or missing SSE event looked like an endless hang, and failures printed only a single message.

## Files

- src/flows/flow-kit.ts
- src/flows/ondc-baseline-igm.flow.ts

## API/contract impact

None. The flow request bodies and step order are unchanged. No server code and no ONDC wire payloads changed.

## Validation

- `npx tsc --noEmit -p .`: passed (exit 0)
- Flows were not executed, because they run against the deployed Render service and the workbench.
