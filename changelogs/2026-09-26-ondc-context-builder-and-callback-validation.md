# Central ONDC context builder, callback context validation, context on every callback response

**Date:** 2026-09-26
**Type:** fix

## What changed

- **`src/utils/ondc-context.ts` is now the one place context is created and checked.**
  - `buildRequestContext(action, …)` builds every outbound context in contract key order. It generates a new `message_id` unless one is passed, stamps `timestamp`, defaults `ttl` to `PT30S`, and adds `bpp_id`/`bpp_uri` only when given (never on `/search`).
  - `contextBaseFromProtocol` maps the camelCase protocol config to the snake_case context fields.
  - Every outbound mapper uses it: search, init, confirm, status, track, cancel, update, issue, issue update, issue_status. The services pass `contextBaseFromProtocol(protocol)` instead of inline field blocks.
- **Every inbound callback's context is validated before the controller runs** (`validateCallbackContext`, applied by the new `src/middlewares/callback-context.middleware.ts` on all nine `/on_*` routes). It checks:
  - `action`: exact match for the route
  - `domain` and `core_version`: equal the configured values (core callbacks only; IGM keeps its own)
  - `country`: ISO alpha-3 code
  - `city`: `std:<code>` or `*`
  - `bap_id`: equals our subscriber id
  - `bap_uri`, `bpp_uri`: http(s) URLs
  - `bpp_id`, `transaction_id`, `message_id`: non-empty strings
  - `timestamp`: RFC 3339
  - `ttl`: optional (absent on most contract callbacks), but must be an ISO 8601 duration if present

  A failure gets an HTTP 200 NACK with `CONTEXT-ERROR 63002`, naming the field. Array-wrapped bodies (workbench's `/on_issue_status`) are validated item by item.
- **Every sync callback response now echoes the received context**, per the contract's `/on_search` ACK sample.
  - `on_search`, `on_status`, `on_track`, `on_cancel`, `on_update`, `on_issue` and `on_issue_status` previously sent a bare `{message:{ack}}`.
  - Unexpected failures in those handlers now return the contract's retriable `CORE-ERROR 63001` NACK with HTTP 503 (as `on_init`/`on_confirm` already did), instead of a non-ONDC HTTP 500 body.
  - `syncResponseContext` now echoes the first item's context for array bodies.
- **`/on_confirm` now logs a warning when its `message_id` differs from the `/confirm` it matched**, and still correlates by `order.id`.

## Why

- Before this change, context was built inline in about 9 places, so its fields could drift between actions.
- Callback context was only partly validated, and differently by each parser.
- Most callback ACKs/NACKs left out the context the contract shows on the sync response.

## Deliberately not done

- **No NACK for `/on_confirm` over a `message_id` mismatch.** The contract correlates `on_confirm` by order_id ("Rules for order confirmation"). A 63002 NACK makes the LSP cancel the order (reason 997), and commit fbac45e notes that LSPs mint their own `message_id` there.
- **No stale-callback check (65003), and no inbound signature verification.** There is currently no verification of inbound signatures, so this is still an open gap.

## Files

- src/utils/ondc-context.ts (new)
- src/middlewares/callback-context.middleware.ts (new)
- src/utils/ondc-error-response.ts
- src/routes/ondc.routes.ts, src/routes/issue.routes.ts
- src/mappers/search.mapper.ts, init.mapper.ts, confirm.mapper.ts, status.mapper.ts, track.mapper.ts, cancel.mapper.ts, update/index.ts, issue.mapper.ts
- src/services/status.service.ts, track.service.ts, cancel.service.ts, update.service.ts, issue.service.ts
- src/controllers/on-search.controller.ts, status.controller.ts, track.controller.ts, cancel.controller.ts, update.controller.ts, issue.controller.ts
- src/repositories/confirm.repository.ts

## API/contract impact

- Outbound payloads have the same fields and values. Key order is now the contract's. `/confirm` now always carries `ttl` (the stored `/init` ttl, or `PT30S`); before, it had none if the `/init` row had none.
- New inbound NACK `CONTEXT-ERROR 63002` for any invalid context field. Because a 63002 on `/on_confirm` leads the LSP to cancel the order, a misconfigured `ONDC_DOMAIN`, `ONDC_CORE_VERSION` or `BAP_ID` would now reject every callback.
- Sync callback responses now carry `context`. The internal-error path moves from HTTP 500 to HTTP 503 with a 63001 NACK.
- No DB schema or Redis changes.

## Validation

- `npx tsc --noEmit -p .` passes (exit 0).
- A scratch script (not committed) ran `validateCallbackContext` on every contract example callback in `.claude/skills/ondc-api-contract/examples/`: on_search ×2, on_init, on_confirm, on_status, on_track, on_cancel ×2, on_update. All passed.
- The same script rejected 8 invalid variants: missing message_id, wrong action, foreign bap_id, bad city, bad timestamp, bad bpp_uri, bad ttl, and a different core_version.
- `buildRequestContext` output was checked for key order and for bpp being omitted on `/search`.
- `src/json/on_issue.json` (a reference sample) fails the city check because of a typo in the sample (`"std:080,"`). It isn't used at runtime.
- No flow run yet.
