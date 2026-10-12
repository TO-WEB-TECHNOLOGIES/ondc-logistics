# `/init` and `/on_init` tables

Schema: `src/db/schema/init-order.schema.ts`
Written by: `src/repositories/init.repository.ts` (`create` for `/init`, `handleCallback` for `/on_init`) via `insertInitOrderSnapshot` / `extractInitOrder` in `src/mappers/init-persistence.mapper.ts`
Read by: `/confirm` (`confirm.repository.ts` → `buildOndcInitOrder`), which rebuilds the outgoing order from these rows

Covers `init_orders` and its six children. The order's provider
locations and tags live in the shared tables; see [shared.md](shared.md).

## The snapshot model

Each `/init` we send gets **its own `ondc_transactions` row**
(`action = 'init'`). Two `init_orders` snapshots hang off that row:

| `snapshot_type` | Written | Content |
| --------------- | ------- | ------- |
| `init` | together with the `/init` txn row, before sending | **What we sent**: provider and location ids, item, fulfillment (pickup/drop location and contact), billing, payment (+ settlement details for `ON-FULFILLMENT`). |
| `on_init` | when `/on_init` arrives without `error` | **What the LSP returned**: everything above as echoed, **plus** quote (total, ttl, breakup) and cancellation terms. |

Unique `(transaction_db_id, snapshot_type)`: at most one of each per
`/init` row. Keeping the two snapshots separate lets us tell "the LSP
omitted a field" apart from "the LSP changed a field".

```text
ondc_transactions (action='init', message_id=msg-init-01)
└── init_orders snapshot 'init'      ─ items, fulfillments(+tags), settlements, provider_locations
└── init_orders snapshot 'on_init'   ─ same children + quote_breakups + cancellation_terms
```

| Condition | Rows |
| --------- | ---- |
| `/init` sent, `/on_init` not yet received | 1 snapshot (`init`). |
| `/on_init` OK | 2 snapshots. The txn is `completed`. |
| `/on_init` with `error` (e.g. `62505` cancellation terms not acceptable) | Only the `init` snapshot. The txn is `failed` with `error_code`. No `on_init` snapshot is written. |
| `/on_init` re-delivered (same `message_id`) | Ignored: the txn's `callback_message_id` already matches. |
| Corrected `/on_init` on the same `/init` row | The old `on_init` snapshot is **deleted** (its children cascade) and a fresh one is inserted. |
| Re-init (user picks another option, or retries) | A **new** `ondc_transactions` init row with its own pair of snapshots. Older pairs stay for audit. `/confirm` uses the latest. |
| `/init` send failed | The `init` snapshot exists. The txn is `failed`. |

---

## `init_orders`

**Role:** the order header for one snapshot. One-to-one sub-objects are
flattened into column groups.

| Column group | Source | Typical `init` | Typical `on_init` |
| ------------ | ------ | -------------- | ----------------- |
| `bpp_id`, `bpp_uri`, `provider_id` | context / `order.provider.id` | ✓ | ✓ |
| `billing_*` (name, email, phone, tax number, address, created/updated) | `order.billing` | ✓ | ✓ (echo) |
| `payment_type`, `payment_collected_by`, `payment_collection_amount` | `order.payment` | ✓ | ✓ |
| `payment_currency` | internal only (not on the wire) | ✓ | — |
| `quote_price_amount`, `quote_price_currency`, `quote_ttl` | `order.quote` | — | ✓ |
| `order_created_at`, `order_updated_at` | `order.created_at` / `updated_at` | usually — | if the LSP sends them |
| `linked_order_*` | `"@ondc/org/linked_order"` | — | — |

`linked_order_*` is usually empty because the linked order is supplied at
`/confirm`, not at init.

Demo rows (illustrative):

| id | transaction_db_id | snapshot_type | provider_id | billing_name | payment_type | payment_collection_amount | quote_price_amount | quote_ttl |
| -- | ----------------- | ------------- | ----------- | ------------ | ------------ | ------------------------: | -----------------: | --------- |
| `io1…` | `a02…` | init | P1 | Sharma Kirana Store | ON-FULFILLMENT | 850.00 | — | — |
| `io2…` | `a02…` | on_init | P1 | Sharma Kirana Store | ON-FULFILLMENT | 850.00 | 69.62 | PT15M |

---

## `init_order_items`

**Role:** `order.items[]`. We always send exactly one item.

| Column | Source |
| ------ | ------ |
| `item_id` (unique per snapshot), `category_id`, `fulfillment_id` | the item chosen from `search_provider_items` |
| `descriptor_*` | `item.descriptor` (code `P2P`/`P2H2P`, name…) |
| `quantity_count` | `item.quantity.count`, if present |
| `time_label` / `time_duration` / `time_timestamp` | `item.time` (TAT). `/init` sends the timestamp as a date only. |

| init_order_id | item_id | category_id | fulfillment_id | descriptor_code | time_duration |
| ------------- | ------- | ----------- | -------------- | --------------- | ------------- |
| `io1…` | I1 | Immediate Delivery | 1 | P2P | PT60M |
| `io2…` | I1 | Immediate Delivery | 1 | P2P | PT60M |

---

## `init_order_fulfillments`

**Role:** `order.fulfillments[]`, with the pickup (`start_*`) and drop
(`end_*`) sides flattened. Fulfillment-level tags are stored in
`tags` / `tag_values` (owner `init_order_fulfillment_id`).

| Column group | Notes |
| ------------ | ----- |
| `fulfillment_id` (unique per snapshot), `type` | Usually `Delivery`. |
| `{start,end}_gps`, `{start,end}_address_*` | Copied from the search's start/end. |
| `{start,end}_contact_phone/email` | The pickup and delivery contacts from the `/init` request. |
| `{start,end}_person_name` | **Overridden** with the search's address names, because the LSP's `person.name` is unreliable. |
| `start_time_duration` | Pickup duration from the catalog fulfillment. |
| `{start,end}_time_range_*`, `{start,end}_time_timestamp` | Slots. Only set if the LSP returns them. |
| `{start,end}_authorization_type` | **Null in current `/init`**: authorization is no longer sent at init. |
| `{start,end}_instruction_*`, `*_instruction_images` (`varchar[]`) | Usually empty at init. Instructions are sent later via `/update`. |
| `awb_no`, `tracking`, `state_code`, `agent_*`, `vehicle_registration` | Post-confirm data. Normally null in both snapshots. They're filled only if an LSP echoes them early. |

| init_order_id | fulfillment_id | type | start_gps | start_person_name | start_contact_phone | end_gps | end_person_name | end_contact_phone | start_time_duration |
| ------------- | -------------- | ---- | --------- | ----------------- | ------------------- | ------- | --------------- | ----------------- | ------------------- |
| `io1…` | 1 | Delivery | 12.9716,77.5946 | Sharma Kirana Store | 9800000001 | 12.9352,77.6245 | Priya Nair | 9800000002 | PT15M |

---

## `init_order_quote_breakups`

**Role:** `order.quote.breakup[]`, the price lines. These exist **only on
`on_init` snapshots**.

| init_order_id | item_id | title_type | price_amount | price_currency |
| ------------- | ------- | ---------- | -----------: | -------------- |
| `io2…` | I1 | delivery | 59.00 | INR |
| `io2…` | I1 | tax | 10.62 | INR |

Other `@ondc/org/title_type` values the contract allows (e.g. `rto`,
`diff`, `tax_diff`) appear as extra lines when the LSP sends them.

---

## `init_order_settlements`

**Role:** `payment["@ondc/org/settlement_details"][]`. These are required
(and sent) when `payment_type = 'ON-FULFILLMENT'` (COD), so the LSP can
remit the collected cash.

| Condition | Rows |
| --------- | ---- |
| Prepaid (`ON-ORDER`) | Usually none. |
| COD (`ON-FULFILLMENT`) | At least one row on the `init` snapshot. The LSP's echo goes on `on_init`. `/init` refuses to persist COD without one. |
| UPI vs bank | `settlement_type = 'upi'` fills `upi_address`. `neft`/`rtgs` fill `settlement_bank_account_no` + `settlement_ifsc_code`. |

| init_order_id | settlement_counterparty | settlement_type | beneficiary_name | upi_address | settlement_bank_account_no | settlement_ifsc_code |
| ------------- | ----------------------- | --------------- | ---------------- | ----------- | -------------------------- | -------------------- |
| `io1…` | lbnp | neft | Sharma Kirana Store | — | 000111222333 | HDFC0000123 |

---

## `init_order_cancellation_terms`

**Role:** `order.cancellation_terms[]`: the cancellation fee by
fulfillment state. These exist **only on `on_init` snapshots**. If the
terms are unacceptable, the contract says to NACK `/on_init` with `62505`.

| init_order_id | fulfillment_state_code | cancellation_fee_percentage | cancellation_fee_amount |
| ------------- | ---------------------- | --------------------------: | ----------------------: |
| `io2…` | Pending | 0.00 | 0.00 |
| `io2…` | Agent-assigned | 100.00 | — |
| `io2…` | Order-picked-up | 100.00 | — |

---

## `init_order_linked_order_items`

**Role:** `"@ondc/org/linked_order".items[]`, the retail items being
shipped. The linked order's scalar fields (weight, dimensions, provider)
live on `init_orders.linked_order_*`.

**Normally empty.** The current `/init` does not send a linked order, and
`/confirm` takes it from the confirm request instead (see
`confirm.mapper.ts`). Rows appear only if an LSP returns one in
`/on_init`.

| init_order_id | descriptor_name | quantity_count | quantity_measure_unit | quantity_measure_value | price_amount |
| ------------- | --------------- | -------------: | --------------------- | ---------------------: | -----------: |
| `io2…` | Basmati Rice 1kg | 1 | kilogram | 1.000000 | 120.00 |
