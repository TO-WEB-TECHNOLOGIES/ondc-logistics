# ONDC Database Schema

## Overview

The project uses **PostgreSQL** with **Drizzle ORM**.

The active ONDC schema defines **18 tables** covering:

- ONDC transaction tracking
- Logistics searches (intent, locations, schedule, payload, payment — all flattened onto one row)
- `/on_search` callback staging and normalized catalog results
- `/init` and `/on_init` order snapshots, fully normalized
- Two shared tables (`provider_locations`, `tags`/`tag_values`) reused across search and init instead of one dedicated table per owner

There are **no JSONB payload columns anywhere in this schema.** Every field
a repository or mapper needs is a typed column, and reads join across the
normalized tables below instead of parsing stored JSON.

This is a deliberately consolidated design: earlier revisions split every
repeating structure into its own table (30 tables at one point). Anything
that was actually 1:1 per parent (a search's schedule, payload, payment,
locations; an order's linked-order scalars) got folded into columns on the
parent row instead. Anything that was a short ordered list with no
independent identity (holidays, instruction images) became a native
Postgres array column. Only genuinely repeating, independently-queried
structures kept their own table — and where the *same* repeating structure
(tags, provider locations) showed up under multiple owners, it got one
shared table instead of one per owner.

### Source Files

| File                                            | Purpose                                          |
| ------------------------------------------------ | ------------------------------------------------- |
| `src/db/schema/index.ts`                        | Schema entry point                               |
| `src/db/schema/ondc-transactions.schema.ts`     | ONDC transaction envelope                        |
| `src/db/schema/logistics-search.schema.ts`      | Logistics search — intent, locations, schedule, payload, payment, all as columns on one table |
| `src/db/schema/on-search-callbacks.schema.ts`   | `/on_search` callback envelope                   |
| `src/db/schema/search-provider.schema.ts`       | Normalized `/on_search` catalog (providers, items, fulfillments, categories, static terms) |
| `src/db/schema/init-order.schema.ts`            | Normalized `/init` and `/on_init` order snapshots, including everything `/confirm` reconstructs from them |
| `src/db/schema/shared.schema.ts`                | Tables shared across owners: `provider_locations`, `tags`, `tag_values` |

For the exact column list of the larger tables, read the schema file
directly — it is the source of truth and this document does not duplicate
every column.

---

# 1. Database Relationship Structure

```text
ondc_transactions
├── logistics_searches                     (locations/schedule/payload/payment as columns)
│   └── on_search_callbacks                (search_id FK, not string matching)
│       └── search_providers               (one row per provider PER CALLBACK)
│           ├── search_provider_categories
│           ├── search_provider_fulfillments
│           │   └── tags (via search_provider_fulfillment_id) → tag_values
│           ├── search_provider_items
│           ├── search_provider_static_terms
│           └── provider_locations (via search_provider_row_id)
│
└── init_orders                            (one row per snapshot_type: 'init' | 'on_init'; linked_order scalars inline)
    ├── provider_locations (via init_order_row_id)
    ├── init_order_items
    ├── init_order_fulfillments             (instruction images as native arrays)
    │   └── tags (via init_order_fulfillment_id) → tag_values
    ├── init_order_quote_breakups
    ├── init_order_settlements
    ├── init_order_cancellation_terms
    ├── init_order_linked_order_items
    └── tags (via init_order_id) → tag_values
```

`provider_locations` and `tags` are **shared tables** — each row belongs to
exactly one owner via a nullable FK per possible owner type (not a
polymorphic `owner_type`/`owner_id` pair), enforced by a `CHECK
(num_nonnulls(...) = 1)` constraint. This keeps a real FK with `ON DELETE
CASCADE` per owner type instead of losing referential integrity to a
generic association.

## Foreign-Key Delete Behaviour

Every foreign key in this schema uses `ON DELETE CASCADE`, except:

| Foreign Key                                   | Delete Behaviour     |
| ---------------------------------------------- | --------------------- |
| `search_provider_items.fulfillment_row_id`    | `ON DELETE SET NULL` |

---

# 2. `ondc_transactions`

Stores the ONDC protocol envelope for every request/response transaction
(`search`, `init`, `confirm`, and their callbacks). No payload columns —
only protocol metadata (ids, participants, timestamps, status).

## Indexes

| Index                                  |
| --------------------------------------- |
| `ondc_transactions_transaction_id_idx` |
| `ondc_transactions_message_id_idx`     |
| `ondc_transactions_action_idx`         |

---

# 3. `logistics_searches`

One row per `/search` request. Previously five tables
(`logistics_search_locations`, `logistics_search_provider_schedules`,
`logistics_search_holidays`, `logistics_search_payloads`,
`logistics_search_payments`) — each was either exactly one row per search
or a short list, so they are now columns on this table:

- `start_*` / `end_*` — the two locations, always present, as column pairs instead of a child table.
- `schedule_*` — provider schedule fields; `schedule_holidays` is a native `date[]` array instead of a child table.
- `payload_*` — shipment weight/dimensions/value/category/dangerous-goods.
- `payment_*` — payment type/collection amount/currency.

---

# 4. `on_search_callbacks`

One row per `/on_search` callback. Carries a **`search_id` FK** directly to
`logistics_searches.id` (not a string-matching join through
`ondc_transactions`). `transaction_id` is still stored for external
correlation and the callback-identity uniqueness constraint.

No `payload` column — callback contents live in `search_providers` and its
children.

## Indexes

Unique on `(transaction_id, message_id, bpp_id)` (`on_search_callbacks_identity_idx`),
plus indexes on `transaction_id` and `search_id`.

---

# 5. Normalized `/on_search` catalog — `search_provider_*`

`search_providers` holds **one row per provider per callback** — never
upserted by `(search, provider)`. Each `/on_search` callback gets its own
independent snapshot of every provider it returned, so multiple BPP
callbacks and repeated/corrected callbacks are all preserved rather than
overwriting each other. Unique on `(callback_id, provider_id)`.

Children:

| Table                                        | Holds                                                          |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| `search_provider_categories`                 | Category id + TAT label/duration/timestamp                     |
| `search_provider_fulfillments`               | Fulfillment id/type, pickup duration, motorable distance + unit; tags live in the shared `tags` table via `search_provider_fulfillment_id` |
| `search_provider_items`                      | Catalog item id, category/fulfillment linkage, descriptor, TAT, price |
| `search_provider_static_terms`               | LSP terms URL/version — no current code path populates it       |
| `provider_locations` (shared)                | Location id + full address, via `search_provider_row_id`       |

`/init` selection and the `/search/:id/options` endpoint both read
exclusively from these tables — never from a stored JSON callback body.

---

# 6. Normalized `/init` and `/on_init` — `init_order_*`

`init_orders` holds **one row per `(transaction, snapshot_type)`**, where
`snapshot_type` is `'init'` (what we sent) or `'on_init'` (what the BPP
returned). Unique on `(transaction_db_id, snapshot_type)`.

This table set exists to let **`/confirm` reconstruct the entire outgoing
order object** (`quote`, `billing`, `payment`, `fulfillments`,
`@ondc/org/linked_order`) from these rows — see
`src/repositories/confirm.repository.ts` and
`src/mappers/init-persistence.mapper.ts#buildOndcInitOrder`. Every field
the current `OndcInitOrder`/`OndcInitFulfillment` TypeScript types model
has a column so nothing is lost in that reconstruction; fields outside
those types don't round-trip — a deliberate trade-off of removing JSONB.

`"@ondc/org/linked_order"`'s scalar fields (weight, dimensions, provider
descriptor) are columns directly on `init_orders` (`linked_order_*`),
since it's 1:1 per snapshot; only its item lines need a child table.

Children of `init_orders`:

| Table                                              | Holds                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------ |
| `provider_locations` (shared)                      | `provider.locations[].id`, ordered, via `init_order_row_id`           |
| `init_order_items`                                 | Item id, category/fulfillment linkage, descriptor, quantity, time     |
| `init_order_fulfillments`                          | Fulfillment id/type/AWB/tracking/state, flattened start/end side (address, authorization, contact, person, agent, vehicle, time, instructions); `start_instruction_images`/`end_instruction_images` are native `varchar[]` arrays; tags live in the shared `tags` table via `init_order_fulfillment_id` |
| `init_order_quote_breakups`                        | `quote.breakup[]` — item id, title type, price                        |
| `init_order_settlements`                           | `payment["@ondc/org/settlement_details"][]`                           |
| `init_order_cancellation_terms`                    | `cancellation_terms[]` — fulfillment state + cancellation fee          |
| `init_order_linked_order_items`                    | `"@ondc/org/linked_order".items[]`, FK'd straight to `init_orders.id` |
| `tags` (shared)                                    | Order-level tags, via `init_order_id`                                  |

---

# 7. Shared tables — `provider_locations`, `tags`, `tag_values`

Both tables serve multiple owners via **nullable FK-per-owner-type
columns**, not a polymorphic `owner_type`/`owner_id` pair — so every owner
still gets a real foreign key with `ON DELETE CASCADE`, and a `CHECK
(num_nonnulls(...) = 1)` constraint guarantees exactly one owner is set.

- `provider_locations` — owners: `search_provider_row_id`, `init_order_row_id`.
- `tags` — owners: `init_order_id`, `init_order_fulfillment_id`, `search_provider_fulfillment_id`. `tag_values` hangs off `tags.id` regardless of which owner the parent tag belongs to.

Trade-off: these tables are wider than a single-owner table would be (one
FK column per possible owner), and a query scoped to "just this owner's
rows" needs to filter on the right FK column rather than joining through a
dedicated table — the query patterns above (`eq(tags.initOrderId, ...)`,
`eq(providerLocations.searchProviderRowId, ...)`) show the pattern used
throughout the repositories.

---

# 8. Schema Summary

|   # | Table                              | Primary Responsibility                              |
| --: | ------------------------------------ | ------------------------------------------------------ |
|   1 | `ondc_transactions`                | ONDC transaction envelope (no payload columns)      |
|   2 | `logistics_searches`               | Search intent, locations, schedule, payload, payment |
|   3 | `on_search_callbacks`              | One row per `/on_search` callback                   |
|   4 | `search_providers`                 | One provider row per callback                       |
|   5 | `search_provider_categories`       | Provider categories and timing                      |
|   6 | `search_provider_fulfillments`     | Fulfillment modes and distance                      |
|   7 | `search_provider_items`            | Catalog items/services                               |
|   8 | `search_provider_static_terms`     | Provider terms and conditions (unpopulated today)   |
|   9 | `init_orders`                      | One row per `/init` or `/on_init` snapshot, incl. linked-order scalars |
|  10 | `init_order_items`                 | Order item lines                                     |
|  11 | `init_order_fulfillments`          | Order fulfillment(s), start/end sides, instruction images |
|  12 | `init_order_quote_breakups`        | Quote breakup lines                                  |
|  13 | `init_order_settlements`           | Payment settlement details                           |
|  14 | `init_order_cancellation_terms`    | Cancellation fee terms                               |
|  15 | `init_order_linked_order_items`    | Linked retail order item lines                       |
|  16 | `provider_locations`               | Shared: search-provider and init-order locations     |
|  17 | `tags`                             | Shared: order/fulfillment tag codes (search + init)  |
|  18 | `tag_values`                       | Shared: tag list values, hangs off `tags`            |

---

# 9. Important Schema Observations

| Observation            | Details                                                               |
| ---------------------- | ---------------------------------------------------------------------- |
| Primary Keys           | Every table uses a UUID primary key with a random default            |
| String Fields          | Most descriptive fields use unrestricted `varchar` columns           |
| Database Enums         | No database-level enums are defined                                  |
| JSON Storage           | None — no JSONB columns exist in this schema                         |
| Array Columns          | `logistics_searches.schedule_holidays` (`date[]`), `init_order_fulfillments.{start,end}_instruction_images` (`varchar[]`) |
| Monetary Values        | `numeric(18,2)`                                                       |
| Physical Measurements  | `numeric(18,6)`                                                       |
| Foreign-Key Indexes    | Foreign-key columns are indexed for joins/lookups                    |
| Shared-Table Ownership | `provider_locations`/`tags` use one nullable FK column per owner type, guarded by a `CHECK (num_nonnulls(...) = 1)` constraint — not a polymorphic `owner_type`/`owner_id` pair |
| Transaction Status     | `ondc_transactions.status` defaults to `pending`                     |
| Callback Status        | `on_search_callbacks.status` defaults to `staged`                    |
| Callback Deduplication | `(transaction_id, message_id, bpp_id)` uniquely identifies a callback |
| Snapshot Deduplication | `(transaction_db_id, snapshot_type)` uniquely identifies an init/on_init snapshot |
| `updated_at` Behaviour | Has a default value but no automatic update trigger                  |

### Timestamp Behaviour

`updated_at` has a default value, but there is **no automatic database
trigger** to update it. Application code must explicitly set it.

---

# 10. Database Configuration

Drizzle is configured in `drizzle.config.ts`.

| Configuration | Value                      |
| -------------- | --------------------------- |
| Dialect        | PostgreSQL                 |
| Schema         | `./src/db/schema/index.ts` |
| Migrations     | `./drizzle`                |

## Database Pools

| Database           | Environment Variable         |
| ------------------- | ------------------------------ |
| Main ONDC database | `PSQL_URI` or `DATABASE_URL` |
| Customer database  | `PSQL_URI_AUTH`              |

The customer Drizzle schema is currently commented out in `src/db/index.ts`;
no customer tables are present in the configured active schema files.

---

# 11. Design Characteristics

1. **Transaction-centric ONDC tracking** — `ondc_transactions` is the root
   transaction record, with no payload columns.
2. **Per-callback catalog snapshots** — `search_providers` and its children
   are scoped to `on_search_callbacks.id`, not upserted by search, so every
   BPP callback's data is preserved independently.
3. **Snapshot-separated init/on-init** — `init_orders.snapshot_type`
   distinguishes what we sent from what the BPP returned.
4. **Flatten what's 1:1 or a short list** — a search's locations/schedule/
   payload/payment, and an order's linked-order scalars, are columns on
   the parent row, not child tables; short ordered lists with no
   independent identity (holidays, instruction images) are native Postgres
   arrays.
5. **Share tables across owners, keep real FKs** — `provider_locations`
   and `tags`/`tag_values` serve multiple owner types through nullable
   FK-per-owner columns plus a `CHECK (num_nonnulls(...) = 1)` constraint,
   rather than duplicating a near-identical table per owner or dropping to
   a polymorphic `owner_type`/`owner_id` pair that loses FK/cascade
   integrity.
6. **No JSONB, no raw-payload fallback** — every repository and mapper
   works off typed columns; `/confirm` reconstructs its outgoing order
   object from `init_order_*` rows rather than a cached JSON blob.
7. **Explicit persistence mappers** — `src/mappers/init-persistence.mapper.ts`
   is the only place that converts between an `OndcInitOrder` object and
   `init_order_*` rows, in both directions.
