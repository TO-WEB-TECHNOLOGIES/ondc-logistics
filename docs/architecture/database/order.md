# `logistics_order`

Schema: `src/db/schema/logistics-order.schema.ts`
Shared helpers: `src/repositories/logistics-order-shared.ts` (`buildLogisticsOrderColumns`, `buildTrackingColumns`, `syncLogisticsOrderTags`)
Written by: the `confirm`, `status`, `update`, `track` and `cancel` repositories

## Role

Holds **one row per confirmed order**: the current, authoritative state of
a logistics order from `/confirm` onward. It is what the frontend's order
endpoints and SSE read. It is the post-order counterpart of `init_orders`,
but it is **one mutable row, not snapshots**.

The table is deliberately flat. It models **one primary item and one
primary fulfillment** per order: element `[0]` of `items[]` and
`fulfillments[]`. A second item or fulfillment is not representable.
Order and fulfillment tags live in `tags` / `tag_values` (owner
`logistics_order_id`).

## Identity and joins

| Column | Notes |
| ------ | ----- |
| `order_id` | **PK** and the network-unique order id **we** mint at `/confirm` (`generateOrderId()` → `od` + `yymmdd` + 8 hex, e.g. `od261012a3f9c2d1`). |
| `transaction_id` | ONDC transaction id. A plain indexed varchar with **no FK**. Joins to `ondc_transactions.transaction_id` / `order_id` by value. |
| `bpp_id`, `bpp_uri`, `provider_id` | The LSP. Every callback is checked against `bpp_id`, and a mismatch is rejected (`invalid_bpp`). |

## Column groups and who writes them

| Group | Columns | Written by |
| ----- | ------- | ---------- |
| Order state | `state`, `order_created_at`, `order_updated_at` | `/confirm` (our sent state, usually `Created`), then `/on_confirm`, `/on_status`, `/on_update` (`state` only), `/on_cancel` |
| Item | `item_id`, `item_category_id`, `item_descriptor_code` (`P2P`/`P2H2P`), `item_descriptor_name`, `item_quantity_count` | `/confirm`, `/on_confirm`, `/on_status` |
| Fulfillment | `fulfillment_id`, `fulfillment_type`, `awb_no`, `fulfillment_state_code`, `fulfillment_state_short_desc` | `/on_confirm`, `/on_status`. `/on_update` sets `awb_no` only. |
| Instructions (PCC/DCC) | `{start,end}_instruction_code/short_desc/long_desc/images[]` | `/confirm` and callbacks; `/update` `START_INSTRUCTION` / `END_INSTRUCTION` |
| Authorization (OTP) | `{start,end}_authorization_type/token/valid_from/valid_to` | `type` from the order; `token` and validity **only** from `/update` `START_AUTHENTICATION` / `END_AUTHENTICATION` |
| Quote | `quote_price_amount`, `quote_price_currency` (total only, no breakup) | `/confirm`, `/on_confirm`, `/on_status` |
| Billing / payment | `billing_name/email/phone`, `payment_type`, `payment_collected_by`, `payment_collection_amount` | `/confirm` and callbacks |
| Linked retail order | `linked_order_*` (retail order id, product name, qty, weight, L/B/H, provider name; first item only) | `/confirm`; `/update` `LINKED_ORDER_DETAILS` / `READY_TO_SHIP` |
| Cancellation | `cancellation_status`, `cancellation_reason_id`, `cancelled_by` | `/cancel` and `/on_cancel` (see below) |
| Tracking snapshot | `tracking_url`, `tracking_status`, `tracking_gps`, `tracking_location_timestamp`, `tracking_updated_at` | `/on_track` only. Latest point only; the breadcrumb path goes over SSE and is **not** stored. |

**How callbacks write the row:** `/on_confirm`, `/on_status` and
`/on_cancel` build the full column set from the callback's order. Columns
whose field is **absent** in the callback are `undefined`, and Drizzle
skips them, so the stored value is kept. Fields that are present
overwrite. Tags are **replaced** wholesale each time.

## Lifecycle

```text
/confirm sent ─► INSERT (upsert on order_id), state = what we sent (e.g. Created)
                 retry of /confirm with the same order_id → same row refreshed
/on_confirm   ─► state Accepted (or Created), fulfillment state Pending,
                 awb_no, tags (e.g. state/ready_to_ship)
/update       ─► instructions / OTP token / linked order / ready_to_ship tag
/on_update    ─► state, awb_no if returned
/on_status    ─► (solicited OR unsolicited) state + fulfillment_state_code progress:
                 Pending → Agent-assigned → Order-picked-up → Out-for-delivery → Order-delivered
                 (RTO path: RTO-Initiated → RTO-Delivered / RTO-Disposed)
/track        ─► /on_track: tracking_* refreshed
/cancel       ─► cancellation_status 'pending' (or 'failed' if the send failed)
/on_cancel    ─► confirmed ⇒ state 'Cancelled', cancellation_status 'succeeded'
```

### `state` vs `fulfillment_state_code`

- `state` is the coarse order state from the contract: `Created`,
  `Accepted`, `In-progress`, `Completed`, `Cancelled`.
- `fulfillment_state_code` is the granular fulfillment state: `Pending`,
  `Agent-assigned`, `Order-picked-up`, `Out-for-delivery`,
  `Order-delivered`, `RTO-Initiated`… See the contract table "Fulfillment
  states & mapping to order states".

### Cancellation columns

| Situation | `state` | `cancellation_status` | `cancellation_reason_id` / `cancelled_by` |
| --------- | ------- | --------------------- | ----------------------------------------- |
| Never cancelled | unchanged | null | null |
| We sent `/cancel` and it was ACKed | unchanged | `pending` | null |
| `/cancel` send failed | unchanged | `failed` | null |
| `/on_cancel` carried `error` (e.g. `60009` invalid reason, `60010` TAT not breached) | unchanged | `failed` | null |
| `/on_cancel` OK but `order.state ≠ Cancelled` | unchanged | unchanged | unchanged (logged, never guessed) |
| Cancellation confirmed (solicited) | `Cancelled` | `succeeded` | from `order.cancellation`, `cancelled_by` = our id |
| **LSP cancelled on its own** (unsolicited `/on_cancel`) | `Cancelled` | `succeeded` | the LSP's reason, `cancelled_by` = the LSP's id |

`state` becomes `Cancelled` **only** on the confirmed transition, never
optimistically on send.

## Row variants (demo)

Illustrative only. Only the relevant columns are shown.

| order_id | state | fulfillment_state_code | awb_no | cancellation_status | cancellation_reason_id | cancelled_by | end_authorization_type / token | tracking_status |
| -------- | ----- | ---------------------- | ------ | ------------------- | ---------------------- | ------------ | ------------------------------ | --------------- |
| `od261012a3f9c2d1` just confirmed | Accepted | Pending | AWB10001 | — | — | — | OTP / — | — |
| `od261012b0c1d2e3` in transit | In-progress | Out-for-delivery | AWB10002 | — | — | — | OTP / `4821` | active |
| `od261012c4d5e6f7` delivered | Completed | Order-delivered | AWB10003 | — | — | — | OTP / `1932` | inactive |
| `od261012d8e9f0a1` cancel pending | Accepted | Pending | AWB10004 | pending | — | — | — | — |
| `od261012e2f3a4b5` cancelled by us | Cancelled | Cancelled | AWB10005 | succeeded | 005 | bap.example.in | — | — |
| `od261012f6a7b8c9` cancelled by LSP | Cancelled | Cancelled | AWB10006 | succeeded | 011 | lsp.example.com | — | — |
| `od2610120a1b2c3d` RTO | In-progress | RTO-Initiated | AWB10007 | — | — | — | — | — |

Common columns for the first row:

| Column | Value |
| ------ | ----- |
| `transaction_id` | `7f3c2e10-…` |
| `bpp_id` / `provider_id` | `lsp.example.com` / `P1` |
| `item_id` / `item_descriptor_code` | `I1` / `P2P` |
| `fulfillment_id` / `fulfillment_type` | `1` / `Delivery` |
| `quote_price_amount` / `_currency` | `69.62` / `INR` |
| `payment_type` / `payment_collection_amount` | `ON-FULFILLMENT` / `850.00` |
| `linked_order_retail_order_id` / `linked_order_product_name` | `RO-55012` / `Basmati Rice 1kg` |
| `linked_order_weight_value` / `_unit` | `1.500000` / `kilogram` |

## Gotchas

- **No stale-callback guard.** `/on_status` writes whatever arrives. An
  older callback delivered late can overwrite a newer state.
  `order_updated_at` is stored but not compared.
- **First element only.** Only `items[0]`, `fulfillments[0]` and
  `linked_order.items[0]` are stored.
- **The OTP token is stored in plain text** (`*_authorization_token`). Treat
  this table as sensitive in exports and logs.
- **`/confirm` retries upsert the same `order_id`**. Each retry still adds
  its own `ondc_transactions` confirm row.
