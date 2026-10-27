# Verbose stream events for track, confirm, update, cancel and issue

**Date:** 2026-10-27
**Type:** feature

## What changed

Stream events for the remaining callbacks now carry the decision-relevant
data from the callback. Existing fields are unchanged; new ones are only
added, and empty values are left out.

- **`order_tracking`** (`/on_track`; order SSE + client stream) adds:
  - `fulfillmentId`, `locationUpdatedAt`
  - `config` (`attr`/`type`: gps + `live_poll`, or url + `deferred`)
  - `trackedOrderId`, raw `tags`

  Built by the new `buildTrackingDetails` (`src/mappers/track-event.mapper.ts`).
- **`order_confirmed`** (`/on_confirm`), **`order_updated`** (`/on_update`) and
  **`order_cancelled`** (`/on_cancel`, plus the `order_status` it publishes to
  the order SSE) add the output of the new `buildOrderEventDetails`
  (`src/mappers/order-event.mapper.ts`):
  - `bppId`/`bppUri`, `createdAt`/`orderUpdatedAt`, all `items`
  - `fulfillments[]`
  - `quote` (`priceAmount`/`priceCurrency`/`ttl`, a superset of the old shape)
    and `quoteBreakups` (same shape as `init_result`)
  - `payment` (+ `status`), `cancellation` (`cancelledBy`/`reasonId`)
  - `cancellationTerms`, `bppTerms`, `linkedOrder`, raw `tags`
- The shared fulfillment builder (`buildStatusFulfillments`, also used by
  `order_status`) now also outputs:
  - `awbNo`
  - `rtoEvent`, `precancelState`, `igmIssueId` (/on_cancel RTO tags)
  - `ewayBillNo`/`ewayBillExpiry`
- **`issue_updated`** / **`issue_status_updated`** add the output of the new
  `buildIssueEventDetails` (`src/mappers/issue-event.mapper.ts`):
  - `status`, `issueType`, `category`/`subCategory`
  - `newActions[]` (side, code, shortDesc, updatedAt, cascadedLevel, org/person)
  - `resolution`
  - `resolutionProvider` (type, org, chatLink, support contact, GROs)
  - `issueUpdatedAt`
- **`*_error` events** (confirm, update, cancel, track, issue, issue_status)
  add `type` and `path` when the error carries them (`errorFields`).

## Why

These events only carried a few flat fields. Rider details, RTO state,
weight-differential and RTO charges, tracking mode and IGM resolutions never
reached the app.

## Files

- src/mappers/order-event.mapper.ts (new)
- src/mappers/track-event.mapper.ts (new)
- src/mappers/issue-event.mapper.ts (new)
- src/mappers/status-event.mapper.ts
- src/repositories/confirm.repository.ts
- src/repositories/update.repository.ts
- src/repositories/cancel.repository.ts
- src/repositories/track.repository.ts
- src/repositories/issue.repository.ts

## API/contract impact

- ONDC wire: none.
- App-facing stream: adds fields only. The events now include personal data:
  rider name/phone/vehicle, GRO and support contacts, proof images.

## Validation

- `npx tsc --noEmit`: passed.
- `npm run build`: passed.
- Scratch script (not committed) ran the contract samples through the new
  mappers:
  - `on_track`: config `tracking.location.gps`/`live_poll`, `trackedOrderId`.
  - `on_confirm`: agent on the fulfillment, 2 quote breakups, 6 bppTerms.
  - `on_update`: e-way bill and pickup slot.
  - `on_cancel` RTO: the RTO fulfillment, `rtoEvent`, `precancelState`,
    `igmIssueId` and `rto` quote lines.
  - An IGM 1.0.0-shaped issue: status, newActions, resolution, provider.
  - Empty inputs returned `{}`.
- The repository wiring was type-checked only; no live callbacks were
  replayed.
