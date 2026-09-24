# Flow scripts: step pacing, wait timeouts, search retry, readable failure output

**Date:** 2026-09-24
**Type:** flow-script

## What changed

- **Step pacing:** after an awaited SSE callback, the next request now waits for `FLOW_STEP_DELAY_MS` (default 3000 ms) before it is sent.
- **Wait timeouts:** `waitFor` no longer waits forever.
  - 120 s for callbacks that answer our own request.
  - 600 s for events the workbench pushes on its own schedule: `order_status`, and `order_cancelled` in the RTO flow.
  - `FLOW_WAIT_TIMEOUT_MS` overrides both.
  - A timeout reports the buffered events, when the last event arrived, and a hint.
- **Search retry:** `/logistics/search` is retried once, 5 s after a 5xx or network failure. A new transaction is created on every attempt. Other requests (confirm, cancel, update, issue…) are never retried.
- **Readable failure output:**
  - Failures now print as a colored box (`✗ FLOW FAILED`) instead of a stack trace.
  - The box shows the step, request, HTTP status and duration, plus the server's `error.code` and `error.message`.
  - It adds a hint for known patterns. For example, a 5xx that took ~30 s means the server's outbound call hit its 30 s axios timeout.
  - For unexpected script bugs, it shows only the first stack frame.
  - The full stack trace appears only with `FLOW_DEBUG=full`.
- **Step logs and summary:** step log lines use icons (→ request, ⇠ SSE event, ✓ passed, ! warning). Every run ends with a summary table of the steps. Colors turn off when the output is not a TTY or `NO_COLOR` is set.
- **Debug dump:** the JSON dump in `reports/flow-runs/` now includes `steps` and the error's details and hint.
- **RTO flow:** `ondc-rto.flow.ts` uses the longer push timeout for the `order_cancelled` event that the workbench initiates.

## Why

The flows worked when run by hand in Postman but failed when scripted.

- The failure dumps showed `/search` returning 500 after ~33 s, and `/confirm` returning 502 after ~37 s. `/confirm` was sent in the same instant the `init_result` SSE event arrived.
- The server pushes that event from inside the `/on_init` handler, before it ACKs the workbench. The script fired the next request before that ACK had gone out; in Postman, the delay between clicks avoided this.
- The old failure output was a stack trace that pointed only into `flow-kit.ts`.

## Files

- src/flows/flow-kit.ts
- src/flows/ondc-rto.flow.ts

## API/contract impact

None. Request bodies, step order, server code and ONDC wire payloads are unchanged.

## Validation

- `npx tsc --noEmit -p .`: passed (exit 0)
- Confirmed that `util.styleText` works on Node v22.12.0.
- The flows were not executed, because they run against the deployed Render service and the workbench.
