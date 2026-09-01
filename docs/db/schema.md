# ONDC Database Schema

## Overview

The project uses **PostgreSQL** with **Drizzle ORM**.

The active ONDC schema defines **14 tables** covering:

- ONDC transaction tracking
- Logistics searches
- Search locations and schedules
- Search payloads and payments
- Logistics Service Provider (LSP) catalog data
- `/on_search` callback staging

### Source Files

| File                                          | Purpose                      |
| --------------------------------------------- | ---------------------------- |
| `src/db/schema/index.ts`                      | Schema entry point           |
| `src/db/schema/ondc-transactions.schema.ts`   | ONDC transaction schema      |
| `src/db/schema/logistics-search.schema.ts`    | Logistics search schema      |
| `src/db/schema/lsp-provider.schema.ts`        | LSP provider/catalog schema  |
| `src/db/schema/on-search-callbacks.schema.ts` | `/on_search` callback schema |

---

# 1. Database Relationship Structure

```text
ondc_transactions
└── logistics_searches
    ├── logistics_search_locations
    ├── logistics_search_provider_schedules
    │   └── logistics_search_holidays
    ├── logistics_search_payloads
    ├── logistics_search_payments
    └── lsp_providers
        ├── lsp_provider_categories
        ├── lsp_provider_fulfillments
        ├── lsp_provider_locations
        ├── lsp_catalog_items
        │   └── parent_item_id → lsp_catalog_items.id
        └── lsp_static_terms

on_search_callbacks
```

## Foreign-Key Delete Behaviour

Most foreign keys use `ON DELETE CASCADE`.

Exceptions:

| Foreign Key                           | Delete Behaviour     |
| ------------------------------------- | -------------------- |
| `lsp_catalog_items.parent_item_id`    | `ON DELETE SET NULL` |
| `lsp_catalog_items.fulfillment_db_id` | `ON DELETE SET NULL` |

---

# 2. `ondc_transactions`

Stores ONDC request/response transaction records.

## Columns

| Column                  | PostgreSQL Type            | Nullable | Default / Description            |
| ----------------------- | -------------------------- | -------: | -------------------------------- |
| `id`                    | `uuid`                     |       No | `gen_random_uuid()`; Primary Key |
| `transaction_id`        | `varchar`                  |       No | —                                |
| `message_id`            | `varchar`                  |       No | —                                |
| `action`                | `varchar`                  |       No | —                                |
| `parent_transaction_id` | `varchar`                  |      Yes | —                                |
| `order_id`              | `varchar`                  |      Yes | —                                |
| `order_state`           | `varchar`                  |      Yes | —                                |
| `status`                | `varchar`                  |       No | `'pending'`                      |
| `error_code`            | `varchar`                  |      Yes | —                                |
| `error_message`         | `varchar`                  |      Yes | —                                |
| `domain`                | `varchar`                  |      Yes | —                                |
| `country`               | `varchar`                  |      Yes | —                                |
| `city`                  | `varchar`                  |      Yes | —                                |
| `core_version`          | `varchar`                  |      Yes | —                                |
| `bap_id`                | `varchar`                  |      Yes | —                                |
| `bap_uri`               | `varchar`                  |      Yes | —                                |
| `bpp_id`                | `varchar`                  |      Yes | —                                |
| `bpp_uri`               | `varchar`                  |      Yes | —                                |
| `timestamp`             | `timestamp with time zone` |      Yes | —                                |
| `ttl`                   | `varchar`                  |      Yes | —                                |
| `request_payload`       | `jsonb`                    |      Yes | —                                |
| `response_payload`      | `jsonb`                    |      Yes | —                                |
| `callback_message_id`   | `varchar`                  |      Yes | —                                |
| `callback_timestamp`    | `timestamp with time zone` |      Yes | —                                |
| `created_at`            | `timestamp with time zone` |       No | `now()`                          |
| `updated_at`            | `timestamp with time zone` |       No | `now()`                          |

## Indexes

| Index                                  |
| -------------------------------------- |
| `ondc_transactions_transaction_id_idx` |
| `ondc_transactions_message_id_idx`     |
| `ondc_transactions_action_idx`         |

---

# 3. `logistics_searches`

Represents a logistics search request associated with an ONDC transaction.

## Columns

| Column                     | PostgreSQL Type            | Nullable | Default / Description       |
| -------------------------- | -------------------------- | -------: | --------------------------- |
| `id`                       | `uuid`                     |       No | Random UUID; Primary Key    |
| `transaction_db_id`        | `uuid`                     |       No | FK → `ondc_transactions.id` |
| `category_id`              | `varchar`                  |      Yes | —                           |
| `fulfillment_type`         | `varchar`                  |      Yes | —                           |
| `authorization_start_type` | `varchar`                  |      Yes | —                           |
| `authorization_end_type`   | `varchar`                  |      Yes | —                           |
| `created_at`               | `timestamp with time zone` |       No | `now()`                     |
| `updated_at`               | `timestamp with time zone` |       No | `now()`                     |

## Relationships

- Many searches belong to one transaction.
- Deleting a transaction deletes its searches.

## Indexes

| Index                                      |
| ------------------------------------------ |
| `logistics_searches_transaction_db_id_idx` |

---

# 4. `logistics_search_locations`

Stores pickup/drop-off locations for a search.

## Columns

| Column          | PostgreSQL Type            | Nullable | Default / Description        |
| --------------- | -------------------------- | -------: | ---------------------------- |
| `id`            | `uuid`                     |       No | Random UUID; Primary Key     |
| `search_id`     | `uuid`                     |       No | FK → `logistics_searches.id` |
| `location_type` | `varchar`                  |      Yes | —                            |
| `gps`           | `varchar`                  |      Yes | —                            |
| `area_code`     | `varchar`                  |      Yes | —                            |
| `name`          | `varchar`                  |      Yes | —                            |
| `building`      | `varchar`                  |      Yes | —                            |
| `locality`      | `varchar`                  |      Yes | —                            |
| `street`        | `varchar`                  |      Yes | —                            |
| `city`          | `varchar`                  |      Yes | —                            |
| `state`         | `varchar`                  |      Yes | —                            |
| `country`       | `varchar`                  |      Yes | —                            |
| `created_at`    | `timestamp with time zone` |       No | `now()`                      |

## Indexes

| Index                                      |
| ------------------------------------------ |
| `logistics_search_locations_search_id_idx` |

---

# 5. `logistics_search_provider_schedules`

Stores provider operating schedules requested during a search.

## Columns

| Column        | PostgreSQL Type            | Nullable | Default / Description        |
| ------------- | -------------------------- | -------: | ---------------------------- |
| `id`          | `uuid`                     |       No | Random UUID; Primary Key     |
| `search_id`   | `uuid`                     |       No | FK → `logistics_searches.id` |
| `days`        | `varchar`                  |      Yes | —                            |
| `duration`    | `varchar`                  |      Yes | —                            |
| `range_start` | `time`                     |      Yes | —                            |
| `range_end`   | `time`                     |      Yes | —                            |
| `created_at`  | `timestamp with time zone` |       No | `now()`                      |

## Indexes

| Index                                               |
| --------------------------------------------------- |
| `logistics_search_provider_schedules_search_id_idx` |

---

# 6. `logistics_search_holidays`

Stores holidays associated with a provider schedule.

## Columns

| Column         | PostgreSQL Type | Nullable | Default / Description                         |
| -------------- | --------------- | -------: | --------------------------------------------- |
| `id`           | `uuid`          |       No | Random UUID; Primary Key                      |
| `schedule_id`  | `uuid`          |       No | FK → `logistics_search_provider_schedules.id` |
| `holiday_date` | `date`          |      Yes | —                                             |

## Indexes

| Index                                       |
| ------------------------------------------- |
| `logistics_search_holidays_schedule_id_idx` |

---

# 7. `logistics_search_payloads`

Stores package dimensions, weight, value, and dangerous-goods information.

## Columns

| Column            | PostgreSQL Type | Nullable | Default / Description        |
| ----------------- | --------------- | -------: | ---------------------------- |
| `id`              | `uuid`          |       No | Random UUID; Primary Key     |
| `search_id`       | `uuid`          |       No | FK → `logistics_searches.id` |
| `weight_value`    | `numeric(18,6)` |      Yes | —                            |
| `weight_unit`     | `varchar`       |      Yes | —                            |
| `length_value`    | `numeric(18,6)` |      Yes | —                            |
| `length_unit`     | `varchar`       |      Yes | —                            |
| `breadth_value`   | `numeric(18,6)` |      Yes | —                            |
| `breadth_unit`    | `varchar`       |      Yes | —                            |
| `height_value`    | `numeric(18,6)` |      Yes | —                            |
| `height_unit`     | `varchar`       |      Yes | —                            |
| `category`        | `varchar`       |      Yes | —                            |
| `value_amount`    | `numeric(18,2)` |      Yes | —                            |
| `value_currency`  | `varchar`       |      Yes | —                            |
| `dangerous_goods` | `boolean`       |      Yes | —                            |

## Indexes

| Index                                     |
| ----------------------------------------- |
| `logistics_search_payloads_search_id_idx` |

---

# 8. `logistics_search_payments`

Stores payment and collection details for a search.

## Columns

| Column              | PostgreSQL Type | Nullable | Default / Description        |
| ------------------- | --------------- | -------: | ---------------------------- |
| `id`                | `uuid`          |       No | Random UUID; Primary Key     |
| `search_id`         | `uuid`          |       No | FK → `logistics_searches.id` |
| `type`              | `varchar`       |      Yes | —                            |
| `collection_amount` | `numeric(18,2)` |      Yes | —                            |
| `currency`          | `varchar`       |      Yes | —                            |

## Indexes

| Index                                     |
| ----------------------------------------- |
| `logistics_search_payments_search_id_idx` |

---

# 9. `lsp_providers`

Stores logistics service providers returned for a search.

## Columns

| Column              | PostgreSQL Type            | Nullable | Default / Description        |
| ------------------- | -------------------------- | -------: | ---------------------------- |
| `id`                | `uuid`                     |       No | Random UUID; Primary Key     |
| `search_id`         | `uuid`                     |       No | FK → `logistics_searches.id` |
| `provider_id`       | `varchar`                  |       No | —                            |
| `name`              | `varchar`                  |      Yes | —                            |
| `short_description` | `varchar`                  |      Yes | —                            |
| `long_description`  | `varchar`                  |      Yes | —                            |
| `created_at`        | `timestamp with time zone` |       No | `now()`                      |
| `updated_at`        | `timestamp with time zone` |       No | `now()`                      |

## Indexes

| Index                           |
| ------------------------------- |
| `lsp_providers_search_id_idx`   |
| `lsp_providers_provider_id_idx` |

---

# 10. `lsp_provider_categories`

Stores categories and time-related information offered by an LSP.

## Columns

| Column           | PostgreSQL Type            | Nullable | Default / Description    |
| ---------------- | -------------------------- | -------: | ------------------------ |
| `id`             | `uuid`                     |       No | Random UUID; Primary Key |
| `provider_db_id` | `uuid`                     |       No | FK → `lsp_providers.id`  |
| `category_id`    | `varchar`                  |      Yes | —                        |
| `time_label`     | `varchar`                  |      Yes | —                        |
| `duration`       | `varchar`                  |      Yes | —                        |
| `timestamp`      | `timestamp with time zone` |      Yes | —                        |
| `created_at`     | `timestamp with time zone` |       No | `now()`                  |

## Indexes

| Index                                        |
| -------------------------------------------- |
| `lsp_provider_categories_provider_db_id_idx` |

---

# 11. `lsp_provider_fulfillments`

Stores fulfillment modes and delivery distance information.

## Columns

| Column                    | PostgreSQL Type            | Nullable | Default / Description    |
| ------------------------- | -------------------------- | -------: | ------------------------ |
| `id`                      | `uuid`                     |       No | Random UUID; Primary Key |
| `provider_db_id`          | `uuid`                     |       No | FK → `lsp_providers.id`  |
| `fulfillment_id`          | `varchar`                  |      Yes | —                        |
| `type`                    | `varchar`                  |      Yes | —                        |
| `pickup_duration`         | `varchar`                  |      Yes | —                        |
| `motorable_distance`      | `numeric(18,6)`            |      Yes | —                        |
| `motorable_distance_unit` | `varchar`                  |      Yes | —                        |
| `created_at`              | `timestamp with time zone` |       No | `now()`                  |

## Indexes

| Index                                          |
| ---------------------------------------------- |
| `lsp_provider_fulfillments_provider_db_id_idx` |

---

# 12. `lsp_provider_locations`

Stores LSP service locations.

## Columns

| Column           | PostgreSQL Type            | Nullable | Default / Description    |
| ---------------- | -------------------------- | -------: | ------------------------ |
| `id`             | `uuid`                     |       No | Random UUID; Primary Key |
| `provider_db_id` | `uuid`                     |       No | FK → `lsp_providers.id`  |
| `location_id`    | `varchar`                  |      Yes | —                        |
| `gps`            | `varchar`                  |      Yes | —                        |
| `street`         | `varchar`                  |      Yes | —                        |
| `city`           | `varchar`                  |      Yes | —                        |
| `state`          | `varchar`                  |      Yes | —                        |
| `area_code`      | `varchar`                  |      Yes | —                        |
| `created_at`     | `timestamp with time zone` |       No | `now()`                  |

## Indexes

| Index                                       |
| ------------------------------------------- |
| `lsp_provider_locations_provider_db_id_idx` |

---

# 13. `lsp_catalog_items`

Stores catalog items/services offered by an LSP.

## Columns

| Column              | PostgreSQL Type            | Nullable | Default / Description                   |
| ------------------- | -------------------------- | -------: | --------------------------------------- |
| `id`                | `uuid`                     |       No | Random UUID; Primary Key                |
| `provider_db_id`    | `uuid`                     |       No | FK → `lsp_providers.id`                 |
| `parent_item_id`    | `uuid`                     |      Yes | Self-reference → `lsp_catalog_items.id` |
| `category_id`       | `varchar`                  |      Yes | —                                       |
| `fulfillment_db_id` | `uuid`                     |      Yes | FK → `lsp_provider_fulfillments.id`     |
| `catalog_item_id`   | `varchar`                  |      Yes | —                                       |
| `descriptor_code`   | `varchar`                  |      Yes | —                                       |
| `name`              | `varchar`                  |      Yes | —                                       |
| `short_description` | `varchar`                  |      Yes | —                                       |
| `long_description`  | `varchar`                  |      Yes | —                                       |
| `tat_label`         | `varchar`                  |      Yes | —                                       |
| `tat_duration`      | `varchar`                  |      Yes | —                                       |
| `tat_timestamp`     | `timestamp with time zone` |      Yes | —                                       |
| `price_amount`      | `numeric(18,2)`            |      Yes | —                                       |
| `price_currency`    | `varchar`                  |      Yes | —                                       |
| `created_at`        | `timestamp with time zone` |       No | `now()`                                 |
| `updated_at`        | `timestamp with time zone` |       No | `now()`                                 |

## Relationships

| Column              | Relationship                     | Delete Behaviour |
| ------------------- | -------------------------------- | ---------------- |
| `provider_db_id`    | → `lsp_providers.id`             | Cascade          |
| `parent_item_id`    | → `lsp_catalog_items.id`         | Set NULL         |
| `fulfillment_db_id` | → `lsp_provider_fulfillments.id` | Set NULL         |

## Indexes

| Index                                     |
| ----------------------------------------- |
| `lsp_catalog_items_provider_db_id_idx`    |
| `lsp_catalog_items_parent_item_id_idx`    |
| `lsp_catalog_items_fulfillment_db_id_idx` |

---

# 14. `lsp_static_terms`

Stores URLs and versions for provider terms and conditions.

## Columns

| Column                 | PostgreSQL Type            | Nullable | Default / Description    |
| ---------------------- | -------------------------- | -------: | ------------------------ |
| `id`                   | `uuid`                     |       No | Random UUID; Primary Key |
| `provider_db_id`       | `uuid`                     |       No | FK → `lsp_providers.id`  |
| `static_terms_url`     | `varchar`                  |      Yes | —                        |
| `static_terms_new_url` | `varchar`                  |      Yes | —                        |
| `effective_date`       | `timestamp with time zone` |      Yes | —                        |
| `version`              | `varchar`                  |      Yes | —                        |
| `created_at`           | `timestamp with time zone` |       No | `now()`                  |
| `updated_at`           | `timestamp with time zone` |       No | `now()`                  |

## Indexes

| Index                                 |
| ------------------------------------- |
| `lsp_static_terms_provider_db_id_idx` |

---

# 15. `on_search_callbacks`

Stores incoming `/on_search` callback payloads, usually for staging and asynchronous processing.

## Columns

| Column           | PostgreSQL Type            | Nullable | Default / Description     |
| ---------------- | -------------------------- | -------: | ------------------------- |
| `id`             | `uuid`                     |       No | Random UUID; Primary Key  |
| `transaction_id` | `varchar`                  |       No | —                         |
| `message_id`     | `varchar`                  |       No | —                         |
| `bpp_id`         | `varchar`                  |       No | —                         |
| `bpp_uri`        | `varchar`                  |      Yes | —                         |
| `payload`        | `jsonb`                    |       No | Complete callback payload |
| `status`         | `varchar`                  |       No | `'staged'`                |
| `error_message`  | `varchar`                  |      Yes | —                         |
| `received_at`    | `timestamp with time zone` |       No | `now()`                   |
| `processed_at`   | `timestamp with time zone` |      Yes | —                         |

## Indexes

### Unique Composite Index

```text
on_search_callbacks_identity_idx
```

Unique combination:

```text
(transaction_id, message_id, bpp_id)
```

### Additional Index

| Index                                    |
| ---------------------------------------- |
| `on_search_callbacks_transaction_id_idx` |

---

# 16. Schema Summary

|   # | Table                                 | Primary Responsibility                 |
| --: | ------------------------------------- | -------------------------------------- |
|   1 | `ondc_transactions`                   | ONDC transaction tracking              |
|   2 | `logistics_searches`                  | Logistics search requests              |
|   3 | `logistics_search_locations`          | Pickup/drop locations                  |
|   4 | `logistics_search_provider_schedules` | Provider operating schedules           |
|   5 | `logistics_search_holidays`           | Schedule holidays                      |
|   6 | `logistics_search_payloads`           | Package dimensions/value/details       |
|   7 | `logistics_search_payments`           | Search payment information             |
|   8 | `lsp_providers`                       | LSP provider records                   |
|   9 | `lsp_provider_categories`             | Provider categories and timing         |
|  10 | `lsp_provider_fulfillments`           | Fulfillment modes and distance         |
|  11 | `lsp_provider_locations`              | LSP service locations                  |
|  12 | `lsp_catalog_items`                   | LSP catalog/services                   |
|  13 | `lsp_static_terms`                    | Provider terms and conditions          |
|  14 | `on_search_callbacks`                 | Incoming `/on_search` callback staging |

---

# 17. Important Schema Observations

| Observation            | Details                                                               |
| ---------------------- | --------------------------------------------------------------------- |
| Primary Keys           | Every table uses a UUID primary key with a random default             |
| String Fields          | Most descriptive fields use unrestricted `varchar` columns            |
| Database Enums         | No database-level enums are defined                                   |
| Length Constraints     | No database-level varchar length limits are defined                   |
| JSON Storage           | JSON payloads use PostgreSQL `jsonb`                                  |
| Monetary Values        | `numeric(18,2)`                                                       |
| Physical Measurements  | `numeric(18,6)`                                                       |
| Distance Values        | `numeric(18,6)`                                                       |
| Foreign-Key Indexes    | Foreign-key columns are indexed for joins/lookups                     |
| Transaction Status     | `ondc_transactions.status` defaults to `pending`                      |
| Callback Status        | `on_search_callbacks.status` defaults to `staged`                     |
| Callback Deduplication | Callback identity is unique on `(transaction_id, message_id, bpp_id)` |
| `updated_at` Behaviour | Has a default value but no automatic update trigger                   |

### JSONB Columns

| Table                 | Column             | Purpose                                |
| --------------------- | ------------------ | -------------------------------------- |
| `ondc_transactions`   | `request_payload`  | Original/request ONDC payload          |
| `ondc_transactions`   | `response_payload` | Response ONDC payload                  |
| `on_search_callbacks` | `payload`          | Incoming `/on_search` callback payload |

### Timestamp Behaviour

`updated_at` has a default value, but there is **no automatic database trigger** to update it.

Therefore:

> Application code must explicitly update `updated_at`.

---

# 18. Database Configuration

Drizzle is configured in `drizzle.config.ts`.

| Configuration | Value                      |
| ------------- | -------------------------- |
| Dialect       | PostgreSQL                 |
| Schema        | `./src/db/schema/index.ts` |
| Migrations    | `./drizzle`                |

## Database Pools

The application currently has two database pools:

| Database           | Environment Variable         |
| ------------------ | ---------------------------- |
| Main ONDC database | `PSQL_URI` or `DATABASE_URL` |
| Customer database  | `PSQL_URI_AUTH`              |

### Customer Database Status

The customer Drizzle schema is currently commented out in:

```text
src/db/index.ts
```

No customer tables are present in the configured active schema files.

Therefore, the schema documented above covers the **14 tables currently defined and migrated for the ONDC database**.

---

# 19. High-Level Data Flow

```text
                         ┌─────────────────────┐
                         │  ONDC Transaction   │
                         │ ondc_transactions   │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │ Logistics Search    │
                         │ logistics_searches  │
                         └──────────┬──────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              │                     │                     │
              ▼                     ▼                     ▼
       Search Locations       Search Payloads       Search Payments
              │
              ▼
       Provider Schedules
              │
              ▼
           Holidays

                                    │
                                    ▼
                           ┌─────────────────┐
                           │  LSP Providers  │
                           │  lsp_providers  │
                           └────────┬────────┘
                                    │
             ┌──────────────┬───────┼───────────┬──────────────┐
             │              │       │           │              │
             ▼              ▼       ▼           ▼              ▼
         Categories   Fulfillments Locations  Catalog Items  Static Terms


                         ┌──────────────────────┐
                         │ /on_search Callbacks │
                         │ on_search_callbacks  │
                         └──────────────────────┘
```

---

# 20. Complete Relationship Map

| Parent Table                          | Child Table                           | Foreign Key                                                     |
| ------------------------------------- | ------------------------------------- | --------------------------------------------------------------- |
| `ondc_transactions`                   | `logistics_searches`                  | `logistics_searches.transaction_db_id` → `ondc_transactions.id` |
| `logistics_searches`                  | `logistics_search_locations`          | `search_id` → `logistics_searches.id`                           |
| `logistics_searches`                  | `logistics_search_provider_schedules` | `search_id` → `logistics_searches.id`                           |
| `logistics_search_provider_schedules` | `logistics_search_holidays`           | `schedule_id` → `logistics_search_provider_schedules.id`        |
| `logistics_searches`                  | `logistics_search_payloads`           | `search_id` → `logistics_searches.id`                           |
| `logistics_searches`                  | `logistics_search_payments`           | `search_id` → `logistics_searches.id`                           |
| `logistics_searches`                  | `lsp_providers`                       | `search_id` → `logistics_searches.id`                           |
| `lsp_providers`                       | `lsp_provider_categories`             | `provider_db_id` → `lsp_providers.id`                           |
| `lsp_providers`                       | `lsp_provider_fulfillments`           | `provider_db_id` → `lsp_providers.id`                           |
| `lsp_providers`                       | `lsp_provider_locations`              | `provider_db_id` → `lsp_providers.id`                           |
| `lsp_providers`                       | `lsp_catalog_items`                   | `provider_db_id` → `lsp_providers.id`                           |
| `lsp_provider_fulfillments`           | `lsp_catalog_items`                   | `fulfillment_db_id` → `lsp_provider_fulfillments.id`            |
| `lsp_catalog_items`                   | `lsp_catalog_items`                   | `parent_item_id` → `lsp_catalog_items.id`                       |
| `lsp_providers`                       | `lsp_static_terms`                    | `provider_db_id` → `lsp_providers.id`                           |

---

# 21. Design Characteristics

The current schema follows a few clear design patterns:

1. **Transaction-centric ONDC tracking**

   - `ondc_transactions` acts as the root transaction record.

2. **Search-specific logistics data**

   - `logistics_searches` represents a logistics search associated with an ONDC transaction.

3. **Normalized search information**

   - Locations, schedules, holidays, payloads, and payments are separated into dedicated tables.

4. **Provider-centric catalog structure**

   - `lsp_providers` acts as the parent for categories, fulfillments, locations, catalog items, and static terms.

5. **Self-referencing catalog hierarchy**

   - `lsp_catalog_items.parent_item_id` allows catalog items to reference parent catalog items.

6. **Raw JSON preservation**

   - Important ONDC request/response/callback payloads are retained as `jsonb`.

7. **Asynchronous callback staging**

   - `/on_search` callbacks are stored separately in `on_search_callbacks`, with a status field and processing timestamps.

8. **Callback idempotency**

   - `(transaction_id, message_id, bpp_id)` uniquely identifies a callback and prevents duplicate callback records.
