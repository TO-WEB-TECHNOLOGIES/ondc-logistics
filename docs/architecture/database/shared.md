# Shared tables: `provider_locations`, `tags`, `tag_values`

Schema: `src/db/schema/shared.schema.ts`

The same ONDC structure (a provider location, or a tag group) appears
under several parents. Instead of one near-identical table per parent,
each is stored once. Every possible owner gets its **own nullable FK
column**, and a `CHECK (num_nonnulls(...) = 1)` constraint guarantees that
exactly one owner is set. Each owner still gets a real FK with
`ON DELETE CASCADE`, which a polymorphic `owner_type` / `owner_id` pair
can't give.

**Query pattern:** always filter on the owner column you mean, e.g.
`eq(tags.initOrderFulfillmentId, id)`. Never select tags without an owner
filter.

---

## `provider_locations`

**Role:** `provider.locations[]`, the provider's own locations (e.g. a
hub or store). These are **not** the pickup/drop locations: those are
`start_*` / `end_*` on the search, fulfillment and order rows.

| Owner column | Owner | Written by | Content |
| ------------ | ----- | ---------- | ------- |
| `search_provider_row_id` | `search_providers` | `/on_search` ingest | Full location: id, gps, address |
| `init_order_row_id` | `init_orders` | `/init` and `/on_init` snapshots | Usually **id only**: `/init` sends `locations[{id}]` per the contract, so gps and address are null on the `init` snapshot |

Other columns: `location_id` (ONDC id), `position` (array order, from
0), `gps`, `address_name/building/locality`, `street`, `city`, `state`,
`country`, `area_code`.

| Condition | Rows |
| --------- | ---- |
| Provider sent no `locations` | None for that owner. |
| Provider with 2 locations | 2 rows, `position` 0 and 1. |
| `/init` for a provider without locations | None: `locations` is omitted from `/init`, not sent empty. |

| owner | location_id | position | gps | address_locality | city | area_code |
| ----- | ----------- | -------: | --- | ---------------- | ---- | --------- |
| search_provider_row_id = `sp1…` | L1 | 0 | 12.9784,77.6408 | Indiranagar | Bengaluru | 560038 |
| search_provider_row_id = `sp1…` | L2 | 1 | 12.9121,77.6446 | HSR Layout | Bengaluru | 560102 |
| init_order_row_id = `io1…` | L1 | 0 | — | — | — | — |

---

## `tags`

**Role:** one row per ONDC tag group (`{ code, list[] }`). Its list
entries are rows in `tag_values`.

| Owner column | Owner | Typical `code`s | Write behaviour |
| ------------ | ----- | --------------- | --------------- |
| `search_provider_fulfillment_id` | `search_provider_fulfillments` | `distance` (its values are also copied into `motorable_distance*`) and any other catalog fulfillment tags | Inserted once per callback |
| `init_order_fulfillment_id` | `init_order_fulfillments` | The catalog tags `/init` forwards: `linked_provider`, `fulfill_request`, `fulfill_response`, `linked_order`, `special_req`, `linked_package`; plus whatever `/on_init` echoes | Per snapshot. A corrected `/on_init` replaces them via cascade. |
| `init_order_id` | `init_orders` | Order-level tags in `/on_init`, e.g. LSP terms | Per snapshot |
| `logistics_order_id` | `logistics_order` (FK to `order_id`, a varchar) | `state` (`ready_to_ship`); from `/on_status`: e.g. `tracking`, `fulfillment_delay`, `reverseqc_output` | **Replaced wholesale** by each `/confirm`, `/on_confirm`, `/on_status` and confirmed `/on_cancel`. `/update READY_TO_SHIP` replaces only the `state` tag. |

`logistics_order` has one fulfillment per row, so its order-level and
fulfillment-level tags share the single `logistics_order_id` owner and
can't be told apart afterwards.

---

## `tag_values`

**Role:** the `list[]` entries of a tag: `(code, value)` pairs.
`tag_id` → `tags.id` (cascade). A tag with an empty list has no
`tag_values` rows. `value` can be null.

## Demo: tags with their values

Illustrative only.

| tags.id | owner | tags.code | tag_values (code = value) |
| ------- | ----- | --------- | ------------------------- |
| `t1…` | search_provider_fulfillment_id = `sf1…` | distance | motorable_distance_type = kilometer, motorable_distance = 6.4 |
| `t2…` | search_provider_fulfillment_id = `sf1…` | linked_provider | id = SELLER-77, name = Sharma Kirana Store |
| `t3…` | init_order_fulfillment_id = (fulfillment of `io1…`) | linked_provider | id = SELLER-77, name = Sharma Kirana Store |
| `t4…` | init_order_id = `io2…` | bpp_terms | max_liability = 2, max_liability_cap = 10000 |
| `t5…` | logistics_order_id = `od261012a3f9c2d1` | state | ready_to_ship = yes |
| `t6…` | logistics_order_id = `od261012b0c1d2e3` | fulfillment_delay | state = Order-picked-up, reason_id = 002, timestamp = 2026-10-12T11:40:00Z |

`t2` → `t3` shows a catalog tag being forwarded at `/init`. It is a
**copy** under a new owner, not a shared row.
