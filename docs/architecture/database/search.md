# `logistics_searches`

Schema: `src/db/schema/logistics-search.schema.ts`
Written by: `src/repositories/search.repository.ts` (`createSearch`)

## Role

Holds **one row per `/search` we send**. It is the buyer's search intent,
in other words "what delivery service am I looking for?":

- category (Immediate / Same Day / Next Day / Standard…)
- fulfillment type
- pickup (`start_*`) and drop (`end_*`) locations
- the provider schedule window and holidays
- the shipment payload: weight, dimensions, category, declared value,
  dangerous goods
- payment terms (type, COD amount)

## Why it matters

- It anchors everything `/on_search` returns. `on_search_callbacks.search_id`
  points here, and so do the frontend's `searchId` endpoints
  (`GET /logistics/search/:searchId/options`, the SSE stream).
- `/init` reads the address names from here (`fetchSearchAddressNames`) to
  fill the person names on the order fulfillment.
- It is the **requirement** side only. The LSP's answer (prices, TAT,
  providers) lives in `search_provider_*`, never here.

## Key columns

| Column group | Meaning |
| ------------ | ------- |
| `id` | Internal uuid. This is the `searchId` the API returns to the frontend. |
| `transaction_db_id` | FK → `ondc_transactions.id` (the `action = 'search'` row). Cascades on delete. |
| `category_id`, `fulfillment_type` | Requested category and fulfillment type (`Delivery`). |
| `authorization_start_type` / `_end_type` | Requested pickup/delivery auth, e.g. `OTP`. Null when none was requested. |
| `start_*` / `end_*` | GPS `"lat,lng"` plus the full address of pickup and drop. Both sides are always present. |
| `schedule_days` / `schedule_duration` / `schedule_range_start` / `schedule_range_end` / `schedule_holidays` (`date[]`) | The requested service window. This is **not** a delivery slot. |
| `payload_*` | Shipment weight, L×B×H with units, category, declared value and currency, `payload_dangerous_goods`. Measurements are `numeric(18,6)` and money is `numeric(18,2)`. |
| `payment_type`, `payment_collection_amount`, `payment_currency` | The payment intent. `payment_collection_amount` is set only for COD-style searches. |

Index: `transaction_db_id`.

## Row variants

| Condition | What differs |
| --------- | ------------ |
| Prepaid search | `payment_type = 'ON-ORDER'`. `payment_collection_amount` is null. |
| COD search | `payment_type = 'ON-FULFILLMENT'`. `payment_collection_amount` holds the cash to collect. |
| Pickup or delivery OTP requested | `authorization_start_type` and/or `authorization_end_type = 'OTP'`. Otherwise null. |
| No schedule sent | All `schedule_*` columns are null and `schedule_holidays` is null (not `{}`). |
| Dangerous goods | `payload_dangerous_goods = true`. |
| `/search` send failed | The row still exists. Only the parent `ondc_transactions.status = 'failed'` shows the failure. No callbacks follow. |
| Repeat search by the same user | Always a **new** row with a new transaction. Rows are never reused. |

## Demo row

Illustrative only.

| Column | Value |
| ------ | ----- |
| `id` | `5d0e…c1` (searchId) |
| `transaction_db_id` | `a01…` (search txn) |
| `category_id` | `Immediate Delivery` |
| `fulfillment_type` | `Delivery` |
| `authorization_start_type` / `_end_type` | `null` / `OTP` |
| `start_gps` | `12.9716,77.5946` |
| `start_address_name` | `Sharma Kirana Store` |
| `start_address_locality`, `start_address_city`, `start_area_code` | `MG Road`, `Bengaluru`, `560001` |
| `end_gps` | `12.9352,77.6245` |
| `end_address_name` | `Priya Nair` |
| `end_address_locality`, `end_address_city`, `end_area_code` | `Koramangala`, `Bengaluru`, `560034` |
| `schedule_days` / `schedule_range_start` / `schedule_range_end` | `1,2,3,4,5,6` / `09:00` / `21:00` |
| `schedule_holidays` | `{2026-10-20,2026-11-08}` |
| `payload_weight_value` / `_unit` | `1.500000` / `kilogram` |
| `payload_length/breadth/height_value` (`_unit`) | `30` / `20` / `10` (`centimeter`) |
| `payload_category` | `Grocery` |
| `payload_value_amount` / `_currency` | `850.00` / `INR` |
| `payload_dangerous_goods` | `false` |
| `payment_type` / `payment_collection_amount` | `ON-FULFILLMENT` / `850.00` |
