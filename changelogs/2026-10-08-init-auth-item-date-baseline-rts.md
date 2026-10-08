# Drop /init authorization, date-only item time, baseline ready_to_ship=no

**Date:** 2026-10-08
**Type:** fix

## What changed

- `/init`: no longer sends `fulfillments[].start.authorization` / `end.authorization`.
- `/init` and `/confirm`: `items[].time.timestamp` is now sent date-only (`YYYY-MM-DD`, UTC)
  instead of a full ISO datetime. New helper `toContractDate` in `src/utils/indian-time.ts`.
- Flow scripts: `runSearchInitConfirm` takes an optional `readyToShip`, defaulting to `"no"`,
  for the `/confirm` fulfillment `state.ready_to_ship` tag — all flows now confirm with `"no"`.

## Why

- The contract's `/init` sample carries no `authorization` on start/end.
- Contract: `item.time.timestamp` format is `2023-06-06`.
- Baseline flow review: hardcode `ready_to_ship` as `no` on `/confirm` to complete the flow.

## Files

- src/mappers/init.mapper.ts
- src/mappers/init-persistence.mapper.ts
- src/utils/indian-time.ts
- src/flows/flow-kit.ts

## API/contract impact

`/init` wire payload: start/end `authorization` removed; `items[].time.timestamp` date-only.
`/confirm` wire payload: `items[].time.timestamp` date-only. `/search` and `/update`
authorization unchanged (both contract-supported).

## Validation

- `npx tsc --noEmit -p .` — passed.
- `toContractDate` spot-check via tsx: ISO string and Date both → `2023-06-06`.
