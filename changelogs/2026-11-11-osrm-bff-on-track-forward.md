# Forward processed /on_track to osrm-bff

**Date:** 2026-11-11
**Type:** feature

## What changed

- **Forwarding:** after each successfully processed `/on_track`, the BAP fires a POST to `{OSRM_BFF_URL}/internal/v1/logistics/on_track`.
  - It runs after the DB commit and after the existing `order_tracking` SSE and stream publishes.
  - It isn't awaited, has a timeout, and never throws.
- **Body:** the `order_tracking` event fields, plus:
  - `event`, `transactionId`
  - `fulfillmentState`, from `logistics_order.fulfillment_state_code`
  - `startGps` and `endGps`, from the `/init` snapshot's `init_order_fulfillments`
- **Unknown values** are left out rather than sent as `""` or `null`.
- **Not forwarded:**
  - duplicates
  - `not_found` and `invalid_fulfillment` results
  - `track_error`
- **Config** is read through `envFor`, so the `PREPROD_`/`PROD_` variants work too:
  - `OSRM_BFF_URL`: empty means the feature is off, which is the default.
  - `OSRM_BFF_TOKEN`: sent as `X-Internal-Token` when set.
  - `OSRM_BFF_TIMEOUT_MS`: defaults to 2000.
- **Logging:** one `logger` line per forward, in the `osrm-bff` namespace, holding orderId, transactionId, status or error name, and latency.
  - The payload and GPS values are never logged.
  - These lines go to the file log only; the console shows ERROR only.

## Why

osrm-bff builds road routes for the frontend's live-tracking map. It only learns about a new rider position from our `/on_track`.

## Files

- src/utils/osrm-bff.client.ts (new)
- src/repositories/order-route-points.ts (new)
- src/repositories/track.repository.ts (additive call after the existing publishes)

## API/contract impact

None.
- The ONDC `/on_track` ACK and NACK, `/track`, and `POST /logistics/track` are unchanged.
- The `order_tracking` SSE and stream payloads are unchanged.
- This adds an outbound internal, non-ONDC call only.
- No schema, migration or Redis changes.
- `.env.example` is not updated, by request.

## Validation

- `npx tsc --noEmit -p .`: exit 0.
- Ran `forwardOnTrack` with tsx against a local stub on 127.0.0.1, using dummy data:
  - With no URL set, it is disabled and makes no call.
  - With a URL and token set, the stub received a POST to `/internal/v1/logistics/on_track` with `X-Internal-Token`. `undefined`, `""` and `null` fields were omitted. It logged `on_track forwarded … status 202`.
  - With nothing listening on the port, it logged `on_track forward failed` (TypeError) and did not throw.
  - With `ENV=PREPROD` and `PREPROD_OSRM_BFF_URL` set, it was enabled and forwarded.
- Not run: the end-to-end path through a real `/on_track` against the DB.
