# ONDC Logistics Database Documentation

## `ondc_transactions`

**What each row represents:**
One ONDC protocol transaction/message record containing metadata such as `transaction_id`, `message_id`, action, participants, timestamps, TTL, and optionally the raw request/response payload.

**Why necessary:**
Provides protocol-level correlation and auditing across `/search`, `/on_search`, `/init`, `/on_init`, `/confirm`, `/on_confirm`, and other ONDC APIs. `transaction_id` identifies the overall ONDC transaction journey, while `message_id` identifies an individual API message.

**Important considerations:**

- `id` is the internal database primary key; `transaction_id` is the ONDC protocol identifier.
- `message_id` identifies a specific message within the transaction.
- Index `transaction_id` and `message_id` for efficient message correlation.
- `request_payload` and `response_payload` should be stored as `JSONB` to retain the original ONDC payload for debugging and auditing.
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
- Keep this table focused on the search itself; detailed search information belongs in its child tables.

---

## `logistics_search_locations`

**What each row represents:**
One location belonging to a search, representing either the **pickup/start** location or the **drop/end** location.

**Why necessary:**
Keeps pickup and drop locations normalized instead of placing separate pickup/drop columns directly inside `logistics_searches`.

**Relationship:**

```text
logistics_search
       │
       ├── START location
       └── END location
```

**Important considerations:**

- `search_id` is an FK to `logistics_searches.id` .
- `location_type` should identify whether the location is `start` or `end` .
- `gps` stores the ONDC GPS coordinate.
- Address fields such as `building` , `locality` , `city` , `state` , and `area_code` are kept separately for structured querying.
- `area_code` should be stored as a string rather than an integer.
- These represent the **locations requested in** `**/search**` ; do not confuse them with `lsp_provider_locations` , which represent provider-side locations returned in `/on_search` .

---

## `logistics_search_provider_schedules`

**What each row represents:**
The requested **delivery-service availability schedule** associated with a search, including applicable days, operating time range, and expected service duration.

**Why necessary:**
Allows the search intent to specify **when the requested delivery service should be available**, without confusing this with the actual delivery/TAT options returned by the LSP in `/on_search`.

**Important considerations:**

- `search_id` is an FK to `logistics_searches.id` .
- `days` represents the requested applicable days.
- `range_start` and `range_end` represent the requested time range.
- `duration` represents the duration specified in the ONDC request, such as `PT30M` .
- This is a **search requirement**, not the actual delivery slot.
- The actual service options and their TAT are returned by the LSP through `/on_search` .
- A search should normally have one provider schedule, so a `UNIQUE(search_id)` constraint is appropriate if this assumption is maintained.

---

## `logistics_search_holidays`

**What each row represents:**
One holiday or unavailable date associated with a search's provider schedule.

**Why necessary:**
Normalizes multiple holiday dates instead of storing an array or comma-separated list inside `logistics_search_provider_schedules`.

**Relationship:**

```text
provider_schedule
       │
       ├── holiday
       ├── holiday
       └── holiday
```

**Important considerations:**

- `schedule_id` is an FK to `logistics_search_provider_schedules.id` .
- `holiday_date` should use the PostgreSQL `date` type.
- A provider schedule can have zero or many holidays.
- No separate generic holiday table is necessary because these dates belong specifically to the search's provider timing.

---

## `logistics_search_payloads`

**What each row represents:**
The physical and commercial details of what the LSP is being asked to transport, including **weight, dimensions, category, declared value, and dangerous-goods status**.

**Why necessary:**
The LSP uses these details when determining **serviceability, pricing, and available delivery options**.

**Important considerations:**

- `search_id` is an FK to `logistics_searches.id` .
- Weight and dimensions should use `decimal` /`numeric` rather than floating-point types.
- Store measurement units alongside their values.
- `value_amount` and `value_currency` should remain separate.
- `dangerous_goods` should be a boolean.
- A search currently represents one shipment payload, so a `UNIQUE(search_id)` constraint is appropriate.
- Do not prematurely model individual packages/items here; introduce that complexity only if required by the later Logistics flow.

---

## `logistics_search_payments`

**What each row represents:**
The payment and collection requirements associated with the logistics search, such as payment type and collection amount.

**Why necessary:**
Stores the payment requirements of the **search intent** separately from shipment information and allows the LSP to understand the expected collection arrangement.

**Important considerations:**

- `search_id` is an FK to `logistics_searches.id` .
- `collection_amount` should use PostgreSQL `decimal` /`numeric` , never floating-point.
- `currency` should be stored separately from the amount.
- `type` can initially be a `varchar` ; it can later become an enum/reference value once the supported ONDC values are finalized.
- Do not mix this with eventual order-level settlement/payment information from `/init` or `/confirm` .
- A search currently has one payment requirement, so a `UNIQUE(search_id)` constraint is appropriate if this remains true.

---

# `/on_search` Database Documentation

## `lsp_providers`

**What each row represents:**
One **LSP/provider returned in response to a particular** `**/search**`, including its ONDC provider ID and descriptive information.

**Why necessary:**
Identifies which Logistics Service Provider is offering the delivery services returned by `/on_search`.

**Important considerations:**

- `id` is the internal database primary key.
- `search_id` is an FK to `logistics_searches.id` .
- `provider_id` is the LSP's ONDC provider identifier and should not be confused with the internal `id` .
- The same real-world LSP can appear in multiple searches, so this table represents a provider's **catalog response for a search**, not a permanent registry of all LSPs.
- `name` , `short_description` , and `long_description` store the provider information returned by the LSP.
- Consider a uniqueness constraint such as `UNIQUE(search_id, provider_id)` to prevent duplicate providers for the same search response.

---

## `lsp_provider_categories`

**What each row represents:**
One delivery category offered by an LSP for a particular search, such as **Immediate Delivery, Same Day Delivery, or Next Day Delivery**, together with its associated TAT information.

**Why necessary:**
Allows the system to store the different delivery categories returned by an LSP and their expected service duration.

**Important considerations:**

- `provider_db_id` is an FK to `lsp_providers.id` .
- `category_id` is the ONDC category identifier.
- `time_label` identifies the timing information label, such as `TAT` .
- `duration` stores the duration returned by the LSP, such as `PT60M` .
- `timestamp` stores the timestamp associated with the returned timing information.
- One provider can offer multiple categories for the same search.

---

## `lsp_provider_fulfillments`

**What each row represents:**
One fulfillment option/process returned by the LSP, such as **Delivery** or **RTO**, including fulfillment-specific timing and distance information.

**Why necessary:**
Provides the fulfillment information that catalog items reference when describing how a particular logistics service is fulfilled.

**Important considerations:**

- `provider_db_id` is an FK to `lsp_providers.id` .
- `fulfillment_id` is the ONDC fulfillment identifier.
- `type` identifies the fulfillment type, such as `Delivery` or `RTO` .
- `pickup_duration` stores the expected time to pickup when provided.
- `motorable_distance` and `motorable_distance_unit` store the distance information returned by the LSP.
- One provider can return multiple fulfillment options.

---

## `lsp_provider_locations`

**What each row represents:**
One location associated with an LSP/provider and returned as part of the `/on_search` catalog.

**Why necessary:**
Stores provider-side operational/location information separately from the pickup and drop locations requested by the buyer.

**Important considerations:**

- `provider_db_id` is an FK to `lsp_providers.id` .
- `location_id` is the ONDC location identifier.
- `gps` stores the provider location coordinates.
- Address components are stored separately for structured access.
- Do not confuse this table with `logistics_search_locations` .
- `logistics_search_locations` = **where the buyer wants the shipment moved**.
- `lsp_provider_locations` = **locations returned by the LSP as part of its catalog/provider information**.

---

## `lsp_catalog_items`

**What each row represents:**
One **concrete logistics service option offered by an LSP**, including its category, fulfillment, description, TAT, and price.

**Why necessary:**
This is the primary catalog data that the application can use to present available logistics options to the buyer.

**Example:**

```text
Immediate Delivery
P2P
45 minute TAT
₹59
```

**Important considerations:**

- `provider_db_id` is an FK to `lsp_providers.id` .
- `catalog_item_id` is the ONDC item identifier.
- `category_id` stores the ONDC category associated with the item.
- `fulfillment_db_id` is an FK to `lsp_provider_fulfillments.id` .
- `tat_duration` stores the expected turnaround time returned by the LSP.
- Price is kept directly in this table for now because each catalog item currently has one primary price.
- `price_amount` should use `decimal` /`numeric` .
- `price_currency` should be stored separately from the amount.
- `parent_item_id` is nullable and is a self-referencing FK to another `lsp_catalog_items.id` .
- The self-reference allows related catalog items such as an RTO item to reference its associated delivery item.
- Do not create a separate relation table for this parent-child relationship.

---

## `lsp_static_terms`

**What each row represents:**
One set/version of the LSP's contractual/static terms information returned through `bpp_terms`, including current terms, new terms, and their effective date.

**Why necessary:**
Preserves the terms information presented by the LSP so that the system can track which contractual terms/version were associated with the catalog and later order flow.

**Important considerations:**

- `provider_db_id` is an FK to `lsp_providers.id` .
- `static_terms_url` stores the current/static terms URL.
- `static_terms_new_url` stores the URL for new/upcoming terms when provided.
- `effective_date` identifies when the new terms become effective.
- `version` can be used to distinguish stored terms versions.
- Terms should not be treated as ordinary catalog descriptions; they have contractual significance.
- Keep this table separate from catalog items because terms can apply to the provider/catalog as a whole rather than to one specific delivery item.

---

# Overall `/search` → `/on_search` Data Model

```text
ondc_transactions
       │
       ▼
logistics_searches
       │
       ├── logistics_search_locations
       │       ├── START
       │       └── END
       │
       ├── logistics_search_provider_schedules
       │       └── logistics_search_holidays
       │
       ├── logistics_search_payloads
       │
       └── logistics_search_payments
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
          lsp_providers
                │
        ┌───────┼────────┬──────────────┐
        │       │        │              │
        ▼       ▼        ▼              ▼
    categories fulfillments locations static_terms
                │
                ▼
        lsp_catalog_items
                │
                └── parent_item_id
                     ↓
               lsp_catalog_items
```

# Core Design Principles

### 1. Separate database identity from ONDC identity

```text
Internal DB identity       ONDC identity
────────────────────       ──────────────
ondc_transactions.id       transaction_id
lsp_providers.id           provider_id
lsp_catalog_items.id       catalog_item_id
lsp_provider_fulfillments.id  fulfillment_id
lsp_provider_locations.id  location_id
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


lsp_*
        ↓
LSP catalog/offerings
```

---

### 3. Use direct foreign keys

Relationships should be represented directly through FK columns:

```text
logistics_searches.transaction_db_id
        → ondc_transactions.id

logistics_search_locations.search_id
        → logistics_searches.id

lsp_providers.search_id
        → logistics_searches.id

lsp_catalog_items.provider_db_id
        → lsp_providers.id
```

Avoid creating artificial relation/junction tables where the relationship is naturally one-to-one or one-to-many.

---

### 4. Use one-to-one constraints where appropriate

Where the design assumes one record per search, enforce it at the database level:

```text
UNIQUE(logistics_search_provider_schedules.search_id)

UNIQUE(logistics_search_payloads.search_id)

UNIQUE(logistics_search_payments.search_id)
```

This prevents accidental duplicate child records.

---

### 5. Keep raw ONDC payloads

The normalized relational fields are for querying and relationships, while `JSONB` payloads preserve the exact ONDC messages.

```text
Relational data
    ↓
Querying / constraints / relationships

Raw JSONB
    ↓
Debugging / auditing / protocol reconstruction
```

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
