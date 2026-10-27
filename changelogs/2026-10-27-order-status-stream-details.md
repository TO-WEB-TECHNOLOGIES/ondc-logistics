# order_status stream: agent, vehicle, tracking, times, delay, proof

**Date:** 2026-10-27
**Type:** feature

## What changed

- `order_status` events from `/on_status` add `fulfillments[]`, built by the new
  `buildStatusFulfillments` (`src/mappers/status-event.mapper.ts`). This covers
  both the order SSE and the client stream. Each entry carries:
  - `fulfillmentId`, `type`, `state { code, shortDesc }`
  - `agent { name, phone }`, `vehicle { registration }`
  - `tracking` (flag) and `trackingInfo` (the `tracking` tag, flattened)
  - `delay` (the first `fulfillment_delay` tag, flattened)
  - `start`/`end` `time` (duration, timestamp, range) and
    `instructions.images` (proof of pickup/delivery)
  - raw `tags`

  Every fulfillment is included, so forward and RTO entries are separate. The
  existing top-level fields are unchanged. Nothing new is persisted.
- The `compact` helper moved from `init-result-event.mapper.ts` to
  `src/utils/compact.ts`, so both event mappers share it. No behaviour change.
- The `order_status` emitted by `cancel.repository.ts` (`/on_cancel`) is
  unchanged.

## Why

`/on_status` carries the rider/vehicle (contract footnotes 208–209), tracking
attributes (215–218) and the delay audit trail (212–214). These were dropped,
so the app couldn't show who is delivering or why something is delayed.

## Files

- src/mappers/status-event.mapper.ts (new)
- src/utils/compact.ts (new)
- src/mappers/init-result-event.mapper.ts
- src/repositories/status.repository.ts

## API/contract impact

- ONDC wire: none.
- App-facing stream: adds fields only.
- `GET /orders/{id}/status` (DB-backed) does not include these fields.

## Validation

- `npx tsc --noEmit`: passed.
- `npm run build`: passed.
- Scratch script (not committed): the contract sample `on_status.json` through
  `buildStatusFulfillments` produced forward + RTO entries with agent,
  vehicle, `trackingInfo`, `delay`, times and proof images. An empty order
  produced `[]`. `buildInitResultEvent` still produced `bppTerms` and
  `riderCheck` after the `compact` move.
