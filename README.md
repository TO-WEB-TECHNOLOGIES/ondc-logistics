# ONDC Logistics API — Buyer NP (BAP)

This service implements the **buyer side (Logistics Buyer NP / BAP)** of an
ONDC Logistics integration. External logistics providers (LSPs) act as
Seller NPs; every order-lifecycle interaction with them is an asynchronous,
signed request/callback pair over the ONDC network.

The ONDC Logistics API Contract (v1.2.5, `docs/ondc/`) is the wire-level
source of truth for every endpoint below — application code maps to and
from it, never the other way around.

## API surface

Every app-facing endpoint takes a **minimal, business-level request body**;
the backend loads persisted state, builds the full signed ONDC payload, and
sends it. Every `/on_*` route is a network callback from the LSP, not
something a frontend calls directly.

| App-facing (frontend → backend) | ONDC callback (LSP → backend) | Flow |
| --- | --- | --- |
| `POST /logistics/search` | `POST /on_search` | Discover serviceable providers/offers |
| `POST /logistics/init` | `POST /on_init` | Initialize order terms & quote |
| `POST /logistics/confirm` | `POST /on_confirm` | Place the logistics order |
| `POST /logistics/update` | `POST /on_update` | Update fulfillment (instructions, OTP, linked order, ready-to-ship) |
| `POST /logistics/status` | `POST /on_status` | Poll current order/fulfillment status |
| `POST /logistics/cancel` | `POST /on_cancel` | Cancel an order (buyer- or LSP-initiated) |
| `POST /logistics/track` | `POST /on_track` | Live shipment tracking |

Polling/SSE companions to the above:

| Endpoint | Purpose |
| --- | --- |
| `GET /logistics/search/:searchId/options` | Poll accumulated `/on_search` results |
| `GET /logistics/search/:searchId/events` | SSE stream of `/on_search` results |
| `GET /logistics/orders/:orderId/status` | Poll current order status |
| `GET /logistics/orders/:orderId/status/events` | SSE stream of order status/cancellation/tracking updates |
| `GET /logistics/orders/:orderId/track` | Poll current tracking snapshot |

Full interactive reference (request/response schemas per endpoint) is
served at **`/swagger`** once the app is running (`/swagger.json` for the
raw OpenAPI document).

## Getting started

```bash
npm install
cp .env.example .env   # fill in DB/Redis URLs + ONDC subscriber/signing keys
npm run db:generate     # generate SQL from the Drizzle schema (review before applying)
npm run db:migrate      # apply migrations to DATABASE_URL
npm run dev              # start the API with hot reload (tsx watch)
```

| Script | Purpose |
| --- | --- |
| `npm run dev` | Run the API locally with hot reload |
| `npm run build` | Type-check and compile to `dist/` |
| `npm start` | Run the compiled build |
| `npm run db:generate` | Generate a Drizzle migration from schema changes |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:push` | Push schema directly (dev convenience — prefer generate+migrate elsewhere) |
| `npm run db:studio` | Open Drizzle Studio against `DATABASE_URL` |

## Repository layout

```
src/
  controllers/    one file per ONDC flow — thin HTTP layer for the app-facing
                  POST and its /on_* callback (validation, logging, ACK/NACK)
  services/       business logic per flow — loads state, builds payloads,
                  orchestrates repository + transport
  repositories/   Drizzle-backed persistence per flow (idempotency, callback
                  correlation, ondc_transactions bookkeeping)
  mappers/        explicit internal-model ⇄ ONDC-wire-payload conversion
  types/
    <flow>/internal.ts   app-facing request/response shapes
    <flow>/ondc.ts        ONDC wire shapes
  utils/          request validation, signing/crypto, ONDC transport,
                  SSE managers, structured logging
  db/schema/      Drizzle table definitions
  routes/         Express router wiring (ondc.routes.ts + routes/index.ts)

drizzle/          generated SQL migrations (see db:generate/db:migrate)
docs/
  ondc/           authoritative ONDC Logistics API Contract — do not modify
  architecture/   database schema/tables, /search → /on_search design
  api/            per-endpoint request/response reference
  integration/    frontend integration notes (SSE ownership)
  testing/        manual smoke-test scripts (PowerShell/curl)
postman/          Postman collection for manual API testing
```

## Architectural conventions

- **Every flow follows the same shape**: minimal request → service loads
  stored routing/state → mapper builds the full ONDC payload → transport
  sends it → repository persists an `ondc_transactions` row keyed by
  `(transaction_id, message_id, action)`, which also doubles as the
  idempotency check on retry.
- **Callbacks ACK immediately**, then validate → correlate to the
  originating transaction/order → persist → publish an SSE update, in that
  order — never treat an unverified callback as trusted, and never publish
  before the durable write.
- **State authority**: ONDC contract → PostgreSQL (Drizzle) → SSE →
  frontend. No parallel/duplicate sources of truth are introduced per flow.
- A given `/on_*` callback can be **solicited** (a reply to our own
  request, correlated by `transaction_id`+`message_id`) or **unsolicited**
  (the LSP acts on its own, correlated by `order_id`) — see
  `src/repositories/cancel.repository.ts` and `status.repository.ts` for
  the two correlation strategies this codebase uses.

## Further reading

- [`docs/ondc/README.md`](docs/ondc/README.md) — contract entry point (the
  authoritative wire-format reference)
- [`docs/architecture/database-schema.md`](docs/architecture/database-schema.md),
  [`database-tables.md`](docs/architecture/database-tables.md) — Postgres schema
- [`docs/architecture/search-overview.md`](docs/architecture/search-overview.md),
  [`on-search-ingestion.md`](docs/architecture/on-search-ingestion.md) — `/search` →
  `/on_search` design in depth
- [`docs/api/update.md`](docs/api/update.md) — `/update` request bodies by type
- [`docs/integration/frontend-sse.md`](docs/integration/frontend-sse.md) — SSE
  ownership contract for frontend integrators
- [`docs/testing/`](docs/testing/) — manual smoke-test scripts per flow
