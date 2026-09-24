---
name: logging-style
description: Project console-logging conventions (colored step lines, correlation ids, failure boxes with hints, no stack traces by default). Use whenever adding or changing logging/console output in src/ or src/flows, and when migrating the codebase's raw console.log calls to the shared logger.
---

# Skill: Logging Style

## Purpose

Keep console output readable, correlated and consistent. The reference
implementation is `src/flows/flow-kit.ts`: see `paint`, `line`, `ids`,
`FlowError`, `httpHint`, `reportFailure` and `printSummary`. New logging
follows that pattern. A later, user-requested task will migrate the rest
of the codebase to it.

## Current state (as of 2026-09-24)

- `src/utils/logger.ts` is the server logger. Keep it as the **single
  entry point**. Do not add a second logger library or a parallel logger.
  - `logger.info/warn/error/debug(namespace, message, meta)` write
    daily-rotated files in `logs/<category>/<category>-<role>-<date>.log`.
  - Categories are `ondc`, `api` and `normal`.
  - Each category is gated by `src/config/log-switches.ts`.
  - Only ERROR lines go to the console today (raw
    `[ts] [ERROR] [ns] msg {json}`).
  - `pgErrorInfo(err)` extracts the real Postgres cause. Spread it into
    the `meta` of every DB error.
- Many modules still call `console.log("[x.controller] ...", {...})`
  directly. The heaviest are `issue.controller.ts`,
  `issue.repository.ts`, `confirm.controller.ts`, `init.controller.ts`,
  `cancel.repository.ts`, and the update/track/status controllers. These
  are the migration targets.
- `src/flows/*` are standalone CLI scripts. They log through `flow-kit.ts`
  and do not use `logger.ts`.

## Rules

### 1. Console format

- Color only through the built-in `styleText` from `node:util`. Add no
  dependency (chalk, pino-pretty, …).
- Apply color only when the stream is a TTY and `NO_COLOR` is unset.
  Wrap `styleText` in a `paint(style, text)` helper that checks this.
- One event per line, in this order:
  1. timestamp, and elapsed time where it is meaningful (dim)
  2. icon
  3. label (namespace or step), bold and padded to a fixed width
  4. message
  5. correlation ids, dim, as `key=value`
- Icons:
  - `→` outbound request
  - `⇠` inbound callback / SSE / received event
  - `✓` success
  - `…` waiting
  - `!` warning
  - `✗` failure
  - `·` debug detail (dim)
- Color meaning: green = success/2xx, yellow = warning/hint, red =
  failure, magenta = inbound events, gray = secondary detail. Do not use
  color decoratively.
- Durations are formatted as `12.3s`. Log how long every network call
  took.

### 2. Correlation ids are mandatory

Every line about an ONDC or API interaction carries whichever of these
ids are known:

- `transactionId`
- `messageId`
- `orderId`
- `searchId`
- `clientId`
- `issueId`
- the ONDC `action`

Use an `ids(payload)`-style helper. It checks top-level fields and
`context`. Never hand-format the ids differently per call site.

### 3. Errors: failure box, not stack trace

- **Expected failures** get a typed error that carries `step`/namespace,
  a one-line `message`, `details: [key, value][]`, an optional `hint`
  and optional `retryable` (see `FlowError`). Expected failures are HTTP
  non-2xx, NACKs, timeouts, validation errors and missing callbacks.
- Render them as a red `✗` headline, then `│ key  value` rows, then a
  yellow `hint` row, then the ids.
  - Pull `error.code` and `error.message` out of JSON bodies. Don't
    print raw one-line JSON blobs.
  - Truncate long values (~400 chars) and note the total length.
- **Hints** are short, actionable and based on facts from this repo. One
  example: a ~30s 5xx on an outbound call means the gateway/workbench
  hit the 30s axios timeout in `src/utils/v1/axios.ts`. Only write a
  hint when the pattern is actually known.
- **Stack traces:**
  - Never print one by default.
  - For an unexpected error (a real bug), print only the first `at …`
    frame.
  - Print the full stack only at the most verbose debug level. Always
    keep it in the file log or JSON dump.
- Keep `error.cause` chains in the message
  (`describeError`: `msg (cause: …)`).

### 4. Levels and switches

- Scripts use one env var with `off | on | full`, like `FLOW_DEBUG`:
  - `off`: steps, the failure box and the summary
  - `on` (default): plus timestamps, events, heartbeats and a dump on
    failure
  - `full`: plus full payloads and stacks
- The server uses `logger` levels and the existing `logSwitches`
  categories. Do not add new env vars or switches without calling it out
  in the plan.
- Long waits emit a dim heartbeat (about every 30s) that says what is
  being waited for, for how long, and what has arrived.

### 5. Files vs console

- Log files stay plain text: `[ts] [LEVEL] [ns] message {json meta}`.
  They must contain no ANSI codes and stay grep- and parse-friendly. The
  pretty format is for the console only.
- On script failure, write a JSON dump to `reports/flow-runs/`
  (gitignored) with the transcript, steps and error details.

### 6. Safety (CLAUDE.md §7)

- Never log private keys, secrets, credentials, the `Authorization` /
  `X-Gateway-Authorization` signature headers, or `.env` values.
- Full ONDC payloads go only to file logs or behind the most verbose
  level. They never go to the console by default.
- Logging must never throw or change control flow. Wrap file/dump writes
  in try/catch. Never let a logging failure turn an ACK into a NACK.

## Migration recipe (only when the user asks)

1. Go one module (or a small group of related modules) per task, through
   the normal plan → approval gate. Start with the files that have the
   most raw `console.log` calls.
2. Replace `console.log("[x.controller] msg", meta)` with
   `logger.info("x", "msg", meta)`. Use `logger.error` + `pgErrorInfo`
   for failures.
3. Upgrade `logger.ts`'s console output once, centrally:
   - Apply the rule 1 format and the rule 3 box.
   - Decide per category which levels reach the console.
   - Keep file output unchanged.

   Do not restyle at each call site.
4. Put the shared helpers (`paint`, `ids`, `describeError`, the box
   renderer) in one place, e.g. a `src/utils/console-format.ts`. Both
   `logger.ts` and `flow-kit.ts` import them from there, so the code is
   not duplicated. Propose this extraction in the plan first.
5. Do not change log file paths, categories, `logSwitches` keys or
   `pgErrorInfo` meta keys without surfacing it in the plan. Log
   consumers may depend on them.
6. Verify with `npx tsc --noEmit -p .`, then check one real request's
   console output and its file log line.

## Checklist for any logging change

- [ ] Goes through `logger` (server) or `flow-kit` helpers (scripts), not
      raw `console.log`
- [ ] Correlation ids present
- [ ] Durations on network calls
- [ ] Expected errors → failure box with details + hint, no stack
- [ ] Colors TTY/`NO_COLOR`-aware; files stay plain
- [ ] No secrets, signatures or full payloads at default level
- [ ] Logging can't throw or alter ACK/NACK behavior
