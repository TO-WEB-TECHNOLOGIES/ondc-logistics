# `/on_search` tables

Schemas: `src/db/schema/on-search-callbacks.schema.ts`, `src/db/schema/search-provider.schema.ts`
Written by: `src/repositories/on-search.repository.ts` (`stage`, then `process` → `insertProvider`)
Read by: `/logistics/search/:searchId/options`, the search SSE stream, and `/init`'s catalog selection (`init.repository.ts`)

Covers `on_search_callbacks`, `search_providers`, `search_provider_categories`,
`search_provider_fulfillments`, `search_provider_items` and
`search_provider_static_terms`. Catalog locations and fulfillment tags
live in the shared tables; see [shared.md](shared.md).

## How a callback is written

```text
/on_search arrives ─► signature + context checks
   │
   ▼  stage(): find the search txn (action='search') → logistics_searches row
   │           dedupe on (transaction_id, message_id, bpp_id)
   │           INSERT on_search_callbacks (status 'staged')
   │           UPDATE ondc_transactions: status 'received', bpp_*, callback_*
   ▼
 sync ACK returned to the LSP
   │
   ▼  process() (in-process, setImmediate), ONE DB transaction:
        INSERT search_providers + categories + fulfillments (+ tags/tag_values)
               + provider_locations + items
        UPDATE on_search_callbacks: status 'processed', processed_at
        UPDATE ondc_transactions:  status 'completed'
   ▼
 SSE "search_result" per provider (only after commit)
```

The catalog is **never upserted**. Each callback keeps its own full
snapshot of every provider it returned, keyed by `callback_id`. Two LSPs,
or one LSP sending a corrected catalog with a new `message_id`, give two
independent snapshots.

---

## `on_search_callbacks`

**Role:** the envelope for each `/on_search` received: one row per
`(transaction_id, message_id, bpp_id)`. It is the staging marker that lets
the ACK happen before the heavy catalog insert.

| Column | Meaning |
| ------ | ------- |
| `search_id` | FK → `logistics_searches.id` (a real FK, not a string match). |
| `transaction_id`, `message_id`, `bpp_id`, `bpp_uri` | The callback's context. `bpp_id` falls back to `'unknown'` if it is missing. |
| `status` | `staged` (default) → `processed`. |
| `error_message` | Exists in the schema but is **not written by any code path today**. |
| `received_at` / `processed_at` | When it was staged / when its catalog was committed. |

Unique: `(transaction_id, message_id, bpp_id)`. Indexes: `transaction_id`, `search_id`.

| Condition | Row state |
| --------- | --------- |
| Normal callback | `staged` → `processed` within milliseconds. |
| **Same callback re-delivered** (LSP retry) | No new row. `stage()` returns `duplicate`, the callback is ACKed again and **not** reprocessed. |
| Catalog ingest threw, or the process crashed after the ACK | Stays `staged` with `processed_at = null` and **no provider rows**. Nothing retries it, and a re-delivery is treated as a duplicate. The parent `ondc_transactions` row stays `received`. |
| Unknown transaction or search | No row. The callback is NACKed (`stage()` returns an empty `callbackId`). |
| Second LSP answers the same search | A second row with a different `bpp_id`. |

Demo rows (illustrative):

| id | search_id | transaction_id | message_id | bpp_id | status | received_at | processed_at |
| -- | --------- | -------------- | ---------- | ------ | ------ | ----------- | ------------ |
| `cb1…` | `5d0e…c1` | `7f3c2e10-…` | `msg-search-01` | lsp.example.com | processed | 10:00:02.110 | 10:00:02.180 |
| `cb2…` | `5d0e…c1` | `7f3c2e10-…` | `msg-search-01` | fastship.example.com | processed | 10:00:03.420 | 10:00:03.470 |
| `cb3…` | `9a77…02` | `0b1d…` | `msg-search-07` | lsp.example.com | staged | 11:12:40.005 | — |

`cb3` is a stuck callback: its catalog failed to ingest after the ACK.

---

## `search_providers`

**Role:** one row per provider **per callback**
(`bpp/providers[]` in the catalog). It is the parent of all catalog detail.

| Column | Meaning |
| ------ | ------- |
| `callback_id` | FK → `on_search_callbacks.id`. |
| `provider_id` | ONDC `provider.id`. It is only unique within its callback. |
| `name`, `short_description`, `long_description` | `provider.descriptor`. |

Unique: `(callback_id, provider_id)`.

| Condition | Rows |
| --------- | ---- |
| Callback with N providers | N rows under that `callback_id`. |
| Same LSP and provider in two callbacks | Two rows with the same `provider_id` and different `callback_id`. |

| id | callback_id | provider_id | name |
| -- | ----------- | ----------- | ---- |
| `sp1…` | `cb1…` | `P1` | Example Logistics |
| `sp2…` | `cb2…` | `FS-BLR` | FastShip Bengaluru |

---

## `search_provider_categories`

**Role:** `provider.categories[]`, the category the provider serves, with
its TAT (`time.label` / `duration` / `timestamp`).

| provider_row_id | category_id | time_label | duration | timestamp |
| --------------- | ----------- | ---------- | -------- | --------- |
| `sp1…` | Immediate Delivery | TAT | PT60M | 2026-10-12T11:00:00Z |
| `sp1…` | Same Day Delivery | TAT | PT6H | — |

There are no rows when the provider sent no `categories`.

---

## `search_provider_fulfillments`

**Role:** `provider.fulfillments[]`, the fulfillment options items point
at. The `distance` tag is lifted into columns. **All** fulfillment tags,
`distance` included, are also stored in `tags` / `tag_values` (owner
`search_provider_fulfillment_id`), and `/init` forwards a subset of them.

| Column | Source |
| ------ | ------ |
| `fulfillment_id`, `type` | `fulfillment.id`, `fulfillment.type` (`Delivery`, `RTO`…) |
| `pickup_duration` | `fulfillment.start.time.duration` |
| `motorable_distance`, `motorable_distance_unit` | the `distance` tag: `motorable_distance` / `motorable_distance_type` |

| id | provider_row_id | fulfillment_id | type | pickup_duration | motorable_distance | unit |
| -- | --------------- | -------------- | ---- | --------------- | -----------------: | ---- |
| `sf1…` | `sp1…` | `1` | Delivery | PT15M | 6.400000 | kilometer |
| `sf2…` | `sp1…` | `2` | RTO | — | — | — |

---

## `search_provider_items`

**Role:** `provider.items[]`, the purchasable services, with price and
TAT. This is what the user picks before `/init`.

| Column | Meaning |
| ------ | ------- |
| `catalog_item_id` | ONDC `item.id`. Unique per provider row. |
| `parent_item_id` | Set for child/variant items. Null otherwise; empty strings are stored as null. |
| `fulfillment_id` + `fulfillment_row_id` | The raw id, plus the FK to the matching fulfillment row in the **same** provider. `ON DELETE SET NULL`. Null if the id didn't match any fulfillment. |
| `category_id`, `descriptor_code` | Category and service code (`P2P` / `P2H2P`). |
| `tat_label` / `tat_duration` / `tat_timestamp` | `item.time`. |
| `price_amount`, `price_currency` | `item.price`. |

| Condition | Row shape |
| --------- | --------- |
| Forward delivery item | `fulfillment_row_id` → the `Delivery` fulfillment and a price is set. |
| RTO item (child of a forward item) | `parent_item_id` = the forward item id, linked to the `RTO` fulfillment. |
| Item referencing an unknown fulfillment | `fulfillment_id` is kept and `fulfillment_row_id` is null. |

| provider_row_id | catalog_item_id | parent_item_id | fulfillment_id | category_id | descriptor_code | tat_duration | price_amount |
| --------------- | --------------- | -------------- | -------------- | ----------- | --------------- | ------------ | -----------: |
| `sp1…` | `I1` | — | `1` | Immediate Delivery | P2P | PT60M | 59.00 |
| `sp1…` | `I2` | `I1` | `2` | Immediate Delivery | P2P | — | 0.00 |

---

## `search_provider_static_terms`

**Role (intended):** LSP static terms (`static_terms`,
`static_terms_new`, `effective_date`, `version`).

**Status:** the table exists but **no code path writes it**. It is always
empty today. If static terms become required, `insertProvider` in
`on-search.repository.ts` is where they would be written.
