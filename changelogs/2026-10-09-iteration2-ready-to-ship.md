# Iteration 2: ready_to_ship per flow, READY_TO_SHIP carries linked order

**Date:** 2026-10-09
**Type:** fix

## What changed

- `/update` `READY_TO_SHIP` now also sends `@ondc/org/linked_order`, built from the stored
  linked order, and accepts an optional `linkedOrder` body field (same flat fields as
  `LINKED_ORDER_DETAILS`) whose values override the stored ones. Supplied overrides are
  persisted. If no linked order is stored or supplied, the object is omitted.
- Linked-order resolution (stored values plus caller overrides) was moved into a shared
  `buildLinkedOrder` helper in `linked-order.mapper.ts`. `LINKED_ORDER_DETAILS` output is
  unchanged.
- Flows: the baseline `/update` uses `READY_TO_SHIP` (confirm `no` → update `yes`).
  Baseline-without-RTS and RTO confirm with `ready_to_ship = "yes"`. Buyer cancellation and
  baseline-IGM are unchanged.
- Docs: `docs/api/update.md`, `docs/integration/post-order.md`, `docs/integration/confirm.md`.

## Why

ONDC reviewer iteration 2 (2026-10-08): the baseline `/update` must carry
`ready_to_ship = "yes"`; baseline-without-RTS (and RTO, which refers to it) must confirm with
`"yes"`. The contract's `/update` sample is the ready-to-ship notification carrying the linked
order, so switching the baseline update type keeps the linked order on the wire.

## Files

- src/types/update/internal.ts
- src/utils/update-validation.ts
- src/mappers/update/linked-order.mapper.ts
- src/mappers/update/ready-to-ship.mapper.ts
- src/repositories/update.repository.ts
- src/controllers/update.controller.ts (swagger)
- src/flows/ondc-baseline.flow.ts, src/flows/ondc-baseline-withoutRTS.flow.ts, src/flows/ondc-rto.flow.ts

## API/contract impact

`/update` (READY_TO_SHIP) wire payload gains `@ondc/org/linked_order` when one is stored,
matching the contract's `/update` sample. App API: optional `linkedOrder` on `READY_TO_SHIP`.
This is an addition and doesn't break existing callers.

## Validation

- `npx tsc --noEmit -p .`: passed.
- Ran `buildUpdateOrder` via tsx on a sample stored row: `ready_to_ship = "yes"`, stored PCC,
  and the linked order are present; overrides apply; with nothing stored, the linked order is
  omitted.
- Workbench flows not re-run.
