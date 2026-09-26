# IGM callbacks: context.city optional

**Date:** 2026-09-26
**Type:** fix

## What changed

- `CallbackContextExpectation` gained an optional `cityOptional` flag (default off).
- `validateCallbackContext` skips the `context.city` check when the flag is set and `city` is absent or an empty string. A present, non-empty `city` is still validated against `std:<STD code>` / `*`.
- `/on_issue` and `/on_issue_status` routes set `cityOptional: true`. All other `/on_*` callbacks still require `city`.

## Why

IGM callbacks without `context.city` were NACKed with CONTEXT-ERROR 63002 before reaching the issue controller. The issue flow does not use the callback's `city`.

## Files

- src/utils/ondc-context.ts
- src/routes/issue.routes.ts

## API/contract impact

Inbound validation only. Outbound `/issue` and `/issue_status` contexts still include `city`. The IGM spec is not in `docs/ondc/`, so this change was made on request, not checked against the contract.

## Validation

- `npx tsc --noEmit` — passed (exit 0).
- Diff inspected.
