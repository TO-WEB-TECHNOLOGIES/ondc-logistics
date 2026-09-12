# ONDC Logistics Database Documentation

## `ondc_transactions`

**What each row represents:**
One ONDC protocol transaction/message record containing metadata such as `transaction_id`, `message_id`, action, participants, timestamps, and TTL. No payload columns — the actual request/response content lives in the normalized tables (`logistics_searches`/`search_provider_*` for search, `init_orders`/`init_order_*` for init).

**Why necessary:**
Provides protocol-level correlation and auditing across `/search`, `/on_search`, `/init`, `/on_init`, `/confirm`, `/on_confirm`, and other ONDC APIs. `transaction_id` identifies the overall ONDC transaction journey, while `message_id` identifies an individual API message.

**Important considerations:**

- `id` is the internal database primary key; `transaction_id` is the ONDC protocol identifier.
- `message_id` identifies a specific message within the transaction.
- Index `transaction_id` and `message_id` for efficient message correlation.
- There is no `request_payload`/`response_payload` JSONB. `/confirm` reconstructs the objects it needs from `init_orders` and its children (see `docs/architecture/database-schema.md`) rather than reading a cached blob.
- `action` identifies the API associated with the message, such as `search` or `on_search` .
- This should remain a shared protocol-level table used by the entire Logistics API lifecycle.

---

## `logistics_searches`

**What each row represents:**
One **logistics search intent** submitted by the Logistics Buyer NP, containing the requested delivery category and fulfillment type.

**Why necessary:**
Acts as the central business record for `/search` and connects all information belonging to that search, including locations, provider schedule, shipment payload, payment requirements, and the LSP catalog returned through `/on_search`.

**Important considerations:**

- `id` is the internal primary key.
- `transaction_db_id` is an FK to `ondc_transactions.id` .
- Do not confuse `transaction_db_id` with the ONDC `transaction_id` .
- `category_id` represents the requested logistics category, such as `Immediate Delivery` , `Same Day Delivery` , or `Next Day Delivery` .
- `fulfillment_type` represents the requested fulfillment type, such as `Delivery` .
- Locations, provider schedule, shipment payload, and payment requirements — previously five separate child tables (`logistics_search_locations`, `logistics_search_provider_schedules`, `logistics_search_holidays`, `logistics_search_payloads`, `logistics_search_payments`) — are now columns on this row, since each was always exactly one-per-search (or, for holidays, a short list):
  - `start_*` / `end_*` — the two requested locations (gps + full address), always both present. Do not confuse these with `provider_locations` (shared table), which represent provider-side locations returned in `/on_search`.
  - `schedule_days` / `schedule_duration` / `schedule_range_start` / `schedule_range_end` — the requested delivery-service availability window; this is a **search requirement**, not the actual delivery slot the LSP returns in `/on_search`.
  - `schedule_holidays` — a native Postgres `date[]` array (no child table needed for a plain list of dates with no independent identity).
  - `payload_*` — weight, dimensions, category, declared value, dangerous-goods status; what the LSP uses for serviceability/pricing.
  - `payment_*` — payment type and collection amount/currency for the search intent. Do not mix with eventual order-level settlement/payment information from `/init` or `/confirm`.
- Keep this table focused on the search itself; catalog data returned by `/on_search` belongs in `search_provider_*`, not here.

---

# `/on_search` Database Documentation

## `on_search_callbacks`

**What each row represents:**
One `/on_search` callback delivery — one BPP, one `message_id`, for a given search's `transaction_id`.

**Why necessary:**
Callbacks are asynchronous and can arrive more than once per search (one per responding BPP, and potentially repeated/corrected deliveries). This table is the staging/dedup boundary before catalog data is normalized into `search_providers` and its children.

**Important considerations:**

- `search_id` is an FK directly to `logistics_searches.id` — added so catalog reads never need to string-match on the ONDC `transaction_id` to find the owning search.
- `transaction_id` (the ONDC string id) is still stored, for external correlation and because callback identity is defined in terms of it.
- `UNIQUE(transaction_id, message_id, bpp_id)` prevents the same callback delivery from being processed twice.
- No `payload` column — see `search_providers` below for where the catalog content actually lives.
- `status` moves `staged → processed` once its providers have been normalized into the tables below.

---

## `search_providers`

**What each row represents:**
One **LSP/provider returned by one `/on_search` callback**, including its ONDC provider ID and descriptive information.

**Why necessary:**
Identifies which Logistics Service Provider is offering the delivery services returned by `/on_search`.

**Important considerations:**

- `id` is the internal database primary key.
- `callback_id` is an FK to `on_search_callbacks.id` — **not** `search_id`. Each callback gets its own independent provider snapshot; providers are never upserted/overwritten across callbacks. This means multiple BPP callbacks for the same search, and a repeated/corrected callback from the same BPP, are all preserved rather than one overwriting another.
- `provider_id` is the LSP's ONDC provider identifier and should not be confused with the internal `id` .
- `name` , `short_description` , and `long_description` store the provider information returned by the LSP.
- `UNIQUE(callback_id, provider_id)` prevents duplicate providers within the same callback's snapshot.

---

## `search_provider_categories`

**What each row represents:**
One delivery category offered by an LSP for a particular search, such as **Immediate Delivery, Same Day Delivery, or Next Day Delivery**, together with its associated TAT information.

**Why necessary:**
Allows the system to store the different delivery categories returned by an LSP and their expected service duration.

**Important considerations:**

- `provider_row_id` is an FK to `search_providers.id` .
- `category_id` is the ONDC category identifier.
- `time_label` identifies the timing information label, such as `TAT` .
- `duration` stores the duration returned by the LSP, such as `PT60M` .
- `timestamp` stores the timestamp associated with the returned timing information.
- One provider can offer multiple categories for the same callback.

---

## `search_provider_fulfillments`

**What each row represents:**
One fulfillment option/process returned by the LSP, such as **Delivery** or **RTO**, including fulfillment-specific timing and distance information.

**Why necessary:**
Provides the fulfillment information that catalog items reference when describing how a particular logistics service is fulfilled.

**Important considerations:**

- `provider_row_id` is an FK to `search_providers.id` .
- `fulfillment_id` is the ONDC fulfillment identifier.
- `type` identifies the fulfillment type, such as `Delivery` or `RTO` .
- `pickup_duration` stores the expected time to pickup when provided.
- `motorable_distance` and `motorable_distance_unit` store the distance information returned by the LSP.
- One provider can return multiple fulfillment options.
- This fulfillment's tag codes (e.g. `linked_provider`, `fulfill_request`) live in the shared `tags` table via `tags.search_provider_fulfillment_id`, with list values in `tag_values` — see the shared-tables section below. `/init` selects a fixed subset of these codes to forward on the order fulfillment it sends to the BPP.

---

## `provider_locations` (shared table)

**What each row represents:**
One location — either an LSP/provider location returned as part of the `/on_search` catalog, **or** a `provider.locations[]` entry on an `/init`/`/on_init` order snapshot. Not a dedicated `search_provider_locations` table; see the shared-tables section below for why.

**Why necessary:**
Stores provider-side operational/location information separately from the pickup and drop locations requested by the buyer (`logistics_searches.start_*`/`end_*`).

**Important considerations:**

- Exactly one of `search_provider_row_id` (→ `search_providers.id`) or `init_order_row_id` (→ `init_orders.id`) is set per row, enforced by a `CHECK` constraint — not both, not neither.
- `location_id` is the ONDC location identifier.
- `gps` stores the location coordinates.
- Address components are stored separately for structured access, including `address_name`/`address_building`/`address_locality`/`country` — the full `OndcAddress` shape, not just street/city/state/area_code, since this data flows through to `/init`'s `provider.locations[].address`.
- `position` orders rows belonging to the same owner (relevant for the init-order side, where `provider.locations[]` order matters for reconstruction).
- Do not confuse this table with `logistics_searches.start_*`/`end_*` columns — those are **where the buyer wants the shipment moved**; `provider_locations` is **locations returned by/sent to the LSP as part of its catalog or order information**.

---

## `search_provider_items`

**What each row represents:**
One **concrete logistics service option offered by an LSP**, including its category, fulfillment, description, TAT, and price.

**Why necessary:**
This is the primary catalog data that the application can use to present available logistics options to the buyer, and what `/init` selection resolves against.

**Example:**

```text
Immediate Delivery
P2P
45 minute TAT
₹59
```

**Important considerations:**

- `provider_row_id` is an FK to `search_providers.id` .
- `catalog_item_id` is the ONDC item identifier.
- `category_id` stores the ONDC category associated with the item.
- `fulfillment_id` (varchar) is the external ONDC fulfillment id — this is what `/init` selection actually matches an item to its fulfillment on. `fulfillment_row_id` is an additional FK to `search_provider_fulfillments.id`, resolved by lookup at insert time, for join convenience.
- `tat_duration` stores the expected turnaround time returned by the LSP.
- Price is kept directly in this table for now because each catalog item currently has one primary price.
- `price_amount` should use `decimal` /`numeric` .
- `price_currency` should be stored separately from the amount.
- `parent_item_id` is a plain `varchar` (the external ONDC id), not a resolved self-referencing FK — no current code path resolves it to a specific sibling row, it is only ever surfaced back to callers as-is.

---

## `search_provider_static_terms`

**What each row represents:**
One set/version of the LSP's contractual/static terms information returned through `bpp_terms`, including current terms, new terms, and their effective date.

**Why necessary:**
Preserves the terms information presented by the LSP so that the system can track which contractual terms/version were associated with the catalog and later order flow.

**Important considerations:**

- `provider_row_id` is an FK to `search_providers.id` .
- `static_terms_url` stores the current/static terms URL.
- `static_terms_new_url` stores the URL for new/upcoming terms when provided.
- `effective_date` identifies when the new terms become effective.
- `version` can be used to distinguish stored terms versions.
- Terms should not be treated as ordinary catalog descriptions; they have contractual significance.
- Keep this table separate from catalog items because terms can apply to the provider/catalog as a whole rather than to one specific delivery item.
- No current code path populates this table (the ONDC provider object doesn't carry a static-terms field today) — carried over from the prior schema for when that changes.

---

## Shared tables: `tags` / `tag_values`

**What each row represents:**
One tag code attached to either an `/on_search` fulfillment, an `/init`/`/on_init` order, or an `/init`/`/on_init` fulfillment. `tag_values` holds that tag's `list[]` of `{code, value}` pairs.

**Why necessary:**
The same repeating structure (a tag code + optional list of code/value pairs) shows up under three different owners. Rather than three near-identical table pairs, there's one `tags`/`tag_values` pair shared across all of them.

**Important considerations:**

- Exactly one of `tags.init_order_id`, `tags.init_order_fulfillment_id`, `tags.search_provider_fulfillment_id` is set per row, enforced by a `CHECK (num_nonnulls(...) = 1)` constraint — each is a real FK with `ON DELETE CASCADE` to its respective owner, not a polymorphic `owner_type`/`owner_id` pair.
- `tag_values.tag_id` FKs to `tags.id` regardless of which owner the parent tag belongs to.
- A query for "this owner's tags" filters on the specific owner column, e.g. `WHERE tags.init_order_id = ...` — see `src/repositories/init.repository.ts` and `src/repositories/init-order-reader.ts` for the pattern.

---

# Overall `/search` → `/on_search` Data Model

```text
ondc_transactions
       │
       ▼
logistics_searches                 (start/end locations, schedule, payload, payment: all columns)
                │
                ▼
              /search
                │
                ▼
                LSP
                │
                ▼
             /on_search
                │
                ▼
        on_search_callbacks        (one row per callback: one BPP, one message_id)
                │
                ▼
          search_providers         (one row per provider PER CALLBACK — not upserted by search)
                │
        ┌───────┼────────┬──────────────────────┐
        │       │        │                      │
        ▼       ▼        ▼                      ▼
    categories fulfillments  provider_locations  static_terms
                │            (shared table)
                ▼
         search_provider_items

    fulfillments ── tags (shared, via search_provider_fulfillment_id) ── tag_values
```

`/init` and `/on_init` (and what `/confirm` reconstructs from them) are a
separate, larger table set — see `docs/architecture/database-schema.md` section 6.

# Core Design Principles

### 1. Separate database identity from ONDC identity

```text
Internal DB identity            ONDC identity
─────────────────────           ──────────────
ondc_transactions.id            transaction_id
search_providers.id             provider_id
search_provider_items.id        catalog_item_id
search_provider_fulfillments.id fulfillment_id
provider_locations.id           location_id (shared table)
```

Internal IDs are used for database relationships; ONDC IDs are stored as business/protocol identifiers.

---

### 2. `/search` and `/on_search` represent opposite sides

```text
/search
   ↓
"What delivery service am I looking for?"

        ↓

/on_search
   ↓
"What delivery services can the LSP offer?"
```

Therefore:

```text
logistics_search_*
        ↓
Buyer search requirements


search_provider_*
        ↓
LSP catalog/offerings, scoped per callback
```

---

### 3. Use direct foreign keys

Relationships should be represented directly through FK columns:

```text
logistics_searches.transaction_db_id
        → ondc_transactions.id

on_search_callbacks.search_id
        → logistics_searches.id

search_providers.callback_id
        → on_search_callbacks.id

search_provider_items.provider_row_id
        → search_providers.id

provider_locations.search_provider_row_id
        → search_providers.id       (nullable — set only for search-side rows)

provider_locations.init_order_row_id
        → init_orders.id            (nullable — set only for init-side rows)
```

Avoid creating artificial relation/junction tables where the relationship is naturally one-to-one or one-to-many. Where a repeating structure has multiple genuinely different owner types (see principle 4a below), prefer one nullable FK column per owner type over a table per owner or a polymorphic `owner_type`/`owner_id` pair.

---

### 4. Flatten what's one-to-one; keep real FKs on shared tables

Where a child table's data was always exactly one row per parent — a
search's schedule, payload, payment, and its two (always-present)
locations — fold it into columns on the parent row instead of a separate
table with a `UNIQUE(parent_id)` constraint. There's nothing to enforce
uniqueness on once it's a column.

Where the *same* repeating structure appears under more than one owner
type (tags, provider locations), share one table across owners instead of
duplicating a near-identical table per owner — but keep a real,
independently-nullable FK column per owner type (with a
`CHECK (num_nonnulls(...) = 1)` constraint) rather than collapsing to a
polymorphic `owner_type` + generic `owner_id`. The check constraint still
lets the database reject a row with zero or multiple owners, and each
owner type still gets `ON DELETE CASCADE` for free.

---

### 5. No raw ONDC payloads, no JSONB

This was previously "keep raw ONDC payloads in JSONB for debugging/auditing
and read from them where relational fields fell short." That design was
reversed in the fresh persistence migration: `ondc_transactions` no longer
has `request_payload`/`response_payload`, and `on_search_callbacks` no
longer has `payload`. Every field a repository, mapper, or `/confirm`
reconstruction needs is a typed column instead.

```text
Relational data
    ↓
Querying / constraints / relationships / protocol reconstruction
```

The trade-off: a field on an ONDC object that isn't in our current
TypeScript types (`src/types/*/ondc.ts`) does not round-trip through the
system. Previously it would silently survive inside the raw JSON blob.

---

### 6. Do not over-normalize

Do not create separate tables for simple values such as:

```text
currency
weight units
dimension units
fulfillment types
delivery categories
countries
cities
```

unless there is a real business requirement for reference-data management.

---

### 7. Keep later lifecycle data separate

Do not add order-level data such as:

```text
rider
AWB
tracking
pickup proof
delivery proof
cancellation
RTO execution
reverse QC
settlement
```

to these tables.

Those belong to later Logistics API stages.

The current scope is:

```text
/search
   ↓
Search Intent
   ↓
/on_search
   ↓
LSP Catalog
```

The resulting schema should therefore remain focused on **search requirements and catalog discovery**.
