# Stream: re-bind endpoint for clientId after reconnect/restart

**Date:** 2026-10-27
**Type:** feature

## What changed

- New `POST /logistics/stream/{clientId}/bind`
  (`src/controllers/stream-bind.controller.ts`, mounted on `streamRouter`).
  - Body: `{ transactionIds?: string[], orderIds?: string[] }`, at least one
    id and at most 100 in total.
  - `transactionIds` are bound directly. Each `orderId` is resolved to its
    `transaction_id` through `logistics_order`.
  - Every resolved transaction is bound to the clientId with
    `clientStreamManager.bind`.
  - Response: `200 { clientId, bound: [...], notFound?: [...] }`, or 400 for
    an invalid body.
  - Idempotent; the last bind wins per transaction.

## Why

Transaction → clientId bindings are in memory and set only at `/search`.
After a server restart (a Render crash), reconnected clients received no
callbacks for transactions started before the restart: every push returned
`no_client_found`.

## Files

- src/controllers/stream-bind.controller.ts (new)
- src/routes/ondc.routes.ts

## API/contract impact

- ONDC wire: none.
- REST: a new endpoint. Existing endpoints and events are unchanged.

## Known limits

- No replay of events missed while unbound.
- No ownership check: anyone who knows an id can bind it, the same trust
  model as `client_id` at `/search`.
- Single instance only, like the in-memory stream itself.

## Validation

- `npx tsc --noEmit`: passed.
- `npm run build`: passed.
- Scratch Express app (not committed) with the real stream manager and
  controller:
  - A push for `TX-OLD` before binding returned `no_client_found`.
  - `POST /stream/C1/bind { transactionIds: ["TX-OLD"] }` returned 200.
  - The next push was delivered and arrived on the open SSE connection.
  - An empty body and a wrong type both returned 400.
- The `orderIds` lookup path was not exercised; it needs the database.
