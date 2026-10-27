# Verbose console logging for every inbound ONDC callback

**Date:** 2026-10-27
**Type:** feature

## What changed

- New `callbackLogMiddleware(action)` (`src/middlewares/callback-log.middleware.ts`)
  is mounted first on all 9 callback routes. It runs before signature and
  context checks, so rejected callbacks are logged too. The routes are:
  `/on_search`, `/on_init`, `/on_confirm`, `/on_update`, `/on_status`,
  `/on_track`, `/on_cancel`, `/on_issue`, `/on_issue_status`.
  - On arrival: a console line `⇠ <action> received <size>` with correlation
    ids (action, transactionId, messageId, bppId, orderId, issueId,
    fulfillmentId).
  - On response: `✓ ACK <status> · <duration>` or `✗ NACK <status> · <duration>`.
    A NACK also prints `│ type/code/path/message` rows from our error body.
  - File log: `ondcLog.inbound` / `ondcLog.inboundAck`. These helpers existed
    but were never called.
- New env var `CALLBACK_LOG` = `off | on | full`, **default `full`**:
  - `full` also prints the full request body and our response body
    (pretty-printed).
  - `on` prints only the two summary lines.
  - `off` silences the console; file logging still happens.
- New `src/utils/console-format.ts` (`paint`, `consoleLine`, `callbackIds`,
  `truncate`, `formatBytes`, `formatMs`, `describeError`). Colors are applied
  only on a TTY with `NO_COLOR` unset.
- Request headers are never logged, including the `Authorization` /
  `X-Gateway-Authorization` signatures. Every logging call is wrapped in
  try/catch, so it cannot change an ACK or NACK.

## Why

Inbound callbacks were only visible through scattered repository
`console.log` lines. Signature rejections showed up only as ERROR lines, and
the inbound ondcLog helpers were unused.

## Files

- src/middlewares/callback-log.middleware.ts (new)
- src/utils/console-format.ts (new)
- src/routes/ondc.routes.ts
- src/routes/issue.routes.ts

## API/contract impact

None. Logging only; ACK/NACK behaviour is unchanged.

## Validation

- `npx tsc --noEmit`: passed.
- `npm run build`: passed.
- Scratch Express app (not committed) with the middleware, posting the
  contract sample `on_status.json` to an ACK handler and a 401 NACK handler:
  - `CALLBACK_LOG=on` printed the ⇠/✓ lines and the ✗ line with the error
    rows.
  - The default `full` level also printed both bodies.
  - A test `Authorization` value never appeared in the output.
  - `logs/ondc/` received the INBOUND and NACK lines.
- Not run against the real server; it was not started.

## Note

At the default `full` level the console (and Render's log retention) gets
full callback bodies, which include customer and rider phone numbers and
addresses. Set `CALLBACK_LOG=on` to reduce this.
