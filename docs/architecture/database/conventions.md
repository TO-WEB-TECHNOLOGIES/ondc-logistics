# Database conventions and configuration

## Configuration

| Item | Value |
| ---- | ----- |
| Engine / ORM | PostgreSQL + Drizzle ORM |
| Schema entry | `src/db/schema/index.ts` |
| Migrations | `./drizzle` (`0000_…` to `0010_…`), config in `drizzle.config.ts` |
| Connection | `PSQL_URI`, falling back to `DATABASE_URL` |

Pools (`src/db/index.ts`):

| Export | Pool | Size env (default) | Used for |
| ------ | ---- | ------------------ | -------- |
| `db1` | `pool1` | `POOL1_MAX` (50) | Every repository today. |
| `db1Ingest` | `poolIngest` | `POOL_INGEST_MAX` (15) | Reserved for bulk catalog ingestion. Same database. |
| `db1Webhook` | `poolWebhook` | `POOL_WEBHOOK_MAX` (15) | Reserved for a webhook process. Same database. |
| — (`db2` commented out) | `pool2` | `POOL2_MAX` (25), `PSQL_URI_AUTH` | Customer DB. No customer tables in this repo. |

All 23 tables described here live in the one ONDC database behind `db1`.

## Column conventions

| Topic | Rule |
| ----- | ---- |
| Primary keys | `uuid` with `defaultRandom()`, **except** `logistics_order.order_id` (varchar, our ONDC order id). |
| Internal vs ONDC ids | `id` / `*_row_id` / `*_db_id` are internal uuids. ONDC ids are stored separately (`transaction_id`, `provider_id`, `catalog_item_id`, `fulfillment_id`, `location_id`, `order_id`, `issue_id`). Never mix the two up in joins. |
| Strings | Unbounded `varchar`. |
| Enums | **None in the database.** Values such as `status`, `snapshot_type`, `state` and `ref_type` are free strings, validated in code. |
| Money | `numeric(18,2)`. |
| Measurements (weight, dimensions, distance) | `numeric(18,6)`. |
| Percentages | `numeric(5,2)` (`cancellation_fee_percentage`). |
| Timestamps | `timestamptz`. `created_at` defaults to `now()`. `updated_at` defaults to `now()` but has **no trigger**, so code must set it on every update. |
| Arrays | Native Postgres arrays for short ordered lists with no identity of their own: `schedule_holidays date[]`, `*_instruction_images varchar[]`, `respondent_ids varchar[]`. |
| JSON | **No JSONB anywhere.** Raw ONDC payloads are not stored. Fields outside the TypeScript types don't round-trip. |
| Deletes | Every FK cascades on delete, **except** `search_provider_items.fulfillment_row_id` (`SET NULL`). `logistics_order` and `issues` have no FK to `ondc_transactions` at all. |
| Uniqueness / dedupe | Unique: `on_search_callbacks (transaction_id, message_id, bpp_id)`, `search_providers (callback_id, provider_id)`, `search_provider_items (provider_row_id, catalog_item_id)`, `init_orders (transaction_db_id, snapshot_type)`, `init_order_items (init_order_id, item_id)`, `init_order_fulfillments (init_order_id, fulfillment_id)`, `issues (issue_id)`, `issue_actors (issue_id, actor_id)`, `issue_actions (issue_id, action_id)`. `ondc_transactions` has **no** unique key; dedupe there is done in code. |

## Design principles

1. **Separate DB identity from ONDC identity.** Relationships use
   internal uuids; ONDC ids are business keys stored alongside them.
2. **The protocol log is separate from domain data.** `ondc_transactions`
   holds the envelope and processing outcome. Search, init, order and
   issue tables hold the content.
3. **Requirement vs offer.** `logistics_searches` is what we asked for.
   `search_provider_*` is what each LSP offered, snapshotted per callback.
4. **Snapshots before confirm, one mutable row after.** `init_orders`
   keeps separate `init` and `on_init` snapshots. `logistics_order` is a
   single row refreshed by every post-order callback.
5. **Flatten what is 1:1.** A search's locations, schedule, payload and
   payment, an order's linked-order scalars, and a fulfillment's start/end
   sides are columns on the parent row, not child tables.
6. **Shared tables keep real FKs.** `provider_locations` and `tags` use
   one nullable FK per owner plus `CHECK num_nonnulls(...) = 1`. They don't
   use a polymorphic owner pair.
7. **Don't over-normalize reference values.** Currencies, units,
   categories, cities and states are plain strings, not lookup tables.
8. **Append-only where history matters.** `issue_actions` is never
   updated. The `/on_search` catalog is never upserted.

## Known gaps (as of 2026-10-12)

| Gap | Where |
| --- | ----- |
| `search_provider_static_terms` is never written | [on-search.md](on-search.md) |
| `on_search_callbacks.error_message` is never written. A failed ingest leaves the callback `staged` with no retry | [on-search.md](on-search.md) |
| `/on_status` has no stale-callback (timestamp) guard | [order.md](order.md) |
| `logistics_order` stores only the first item and fulfillment | [order.md](order.md) |
| OTP tokens are stored in plain text | [order.md](order.md) |
