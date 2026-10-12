# `ondc_transactions`

Schema: `src/db/schema/ondc-transactions.schema.ts`

## Role

This is the protocol log. It holds **one row per ONDC message we send**
(`search`, `init`, `confirm`, `status`, `update`, `track`, `cancel`,
`issue`, `issue_status`). It also holds a row for some **unsolicited
callbacks** that have no outbound request to attach to. The callback
(`on_*`) for a request is recorded **on the request's own row**, in the
`callback_*`, `status`, `order_state` and `error_*` columns. It does not
get a row of its own.

It stores the ONDC `context` envelope (ids, participants, domain/city,
timestamp, ttl) and the processing outcome. It stores **no payload**: the
business content lives in the domain tables (`logistics_searches`,
`init_orders`, `logistics_order`, `issues`…).

## Why it matters

- **Correlation.** Every inbound callback is matched back to our request
  through this table, using `(transaction_id, action, message_id)` and,
  where the contract says so, `order_id`.
- **Idempotency.**
  - Duplicate outbound sends are detected by an existing row with the same
    `(transaction_id, message_id, action[, order_id])`.
  - Duplicate callbacks are detected by `callback_message_id` (or
    `callback_timestamp` for `/on_track`) already being set.
- **Root of the search and init trees.** `logistics_searches.transaction_db_id`
  and `init_orders.transaction_db_id` point at the **row uuid** (`id`),
  not at the ONDC `transaction_id` string.
- **Audit / debugging.** It records which BPP answered, when, and with
  which error code.

## Key columns

| Column | Meaning |
| ------ | ------- |
| `id` | Internal uuid PK. The FK target for `logistics_searches` / `init_orders`. |
| `transaction_id` | ONDC `context.transaction_id`. **Not unique.** One ONDC transaction has many rows (search, init, confirm, status…). |
| `message_id` | ONDC `context.message_id` of **our** request (or of the unsolicited callback). |
| `action` | The *request* action: `search`, `init`, `confirm`, `status`, `update`, `track`, `cancel`, `issue`, `issue_status`. Never `on_*`. |
| `parent_transaction_id` | Set only on `confirm` rows. It holds the init's `transaction_id`, which in practice equals this row's own `transaction_id`. |
| `order_id` | Set on every post-order row (confirm, status, update, track, cancel, issue, issue_status). Null for search and init. |
| `order_state` | Order state reported by the callback (`Created`, `Accepted`, `Cancelled`…) or `failed`. It is written on confirm, update and cancel rows. |
| `status` | Processing lifecycle (see below). Default `pending`. |
| `error_code` / `error_message` | Either our send failure (e.g. `ONDC_SUBMISSION_FAILED`) or the `error` object from the callback. |
| `domain`, `country`, `city`, `core_version`, `bap_id`, `bap_uri`, `bpp_id`, `bpp_uri`, `timestamp`, `ttl` | Copy of the request context. `bpp_*` is empty on a `search` row until the first `/on_search` arrives. |
| `callback_message_id` / `callback_timestamp` | Context of the callback that completed this row. Used as the duplicate-callback guard. |

Indexes: `transaction_id`, `message_id`, `action`. There are no unique
constraints; the repositories enforce dedupe in code.

## `status` lifecycle

```text
               send OK            callback without error
  pending ───────────────► sent ─────────────────────────► completed
     │                       │
     │ send failed           │ callback carries error
     ▼                       ▼
   failed                  failed

search only:  sent ──(first /on_search staged)──► received ──(catalog ingested)──► completed
```

| Value | Written when |
| ----- | ------------ |
| `pending` | The row is inserted, just before the HTTP call to the gateway or BPP. |
| `sent` | The counterparty sync-ACKed our request. |
| `failed` | The send failed (NACK, timeout, transport error), **or** the callback carried `error`. |
| `received` | `search` only: an `/on_search` was staged but its catalog isn't ingested yet. |
| `completed` | The callback was processed without `error`. For `search`, this is set after **each** callback's catalog is committed. |

## Row variants

| Condition | `action` | `order_id` | `status` path | Notes |
| --------- | -------- | ---------- | ------------- | ----- |
| `/search` sent | `search` | null | pending → sent → received → completed | One row even when several BPPs answer. `bpp_id` and `callback_*` show the **latest** callback. |
| `/search` rejected by the gateway | `search` | null | pending → failed | `error_code = ONDC_SUBMISSION_FAILED` |
| `/init` (and each re-init) | `init` | null | pending → sent → completed / failed | Each re-init is a new row with a new `message_id`. `/on_init` is matched by exact `message_id`. |
| `/confirm` | `confirm` | our order id | pending → sent → completed / failed | `order_state` comes from `/on_confirm` (`Created`/`Accepted`…), or `failed` when the callback carries an error. A retry is a new row with the same `order_id` and a new `message_id`. |
| `/status` poll | `status` | order id | pending → sent → completed / failed | An unsolicited `/on_status` creates **no** row. It only completes a status row that is still `sent`, if one exists. |
| `/update` | `update` | order id | pending → sent → completed / failed | `order_state` comes from `/on_update`. |
| `/track` | `track` | order id | pending → sent → completed / failed | A duplicate `/on_track` is detected by `callback_timestamp` already being set. |
| `/cancel` by us | `cancel` | order id | pending → sent → completed / failed | Mirrors `logistics_order.cancellation_status` (see [order.md](order.md)). |
| **Unsolicited** `/on_cancel` (the LSP cancelled on its own) | `cancel` | order id | inserted directly as `completed` / `failed` | `message_id` = the **callback's** message_id. `callback_*` is filled on insert. |
| `/issue` create or action | `issue` | order id | pending → sent → completed / failed | One row per complainant action (OPEN, ESCALATE, CLOSE…). |
| `/issue_status` | `issue_status` | order id | pending → sent → completed / failed | |

## Demo rows

Illustrative only. One transaction (`7f3c2e10-…`), with each row's
lifecycle collapsed to its final state.

| id | transaction_id | message_id | action | order_id | status | order_state | bpp_id | callback_message_id | error_code |
| -- | -------------- | ---------- | ------ | -------- | ------ | ----------- | ------ | ------------------- | ---------- |
| `a01…` | `7f3c2e10-…` | `msg-search-01` | search | — | completed | — | lsp.example.com | `msg-search-01` | — |
| `a02…` | `7f3c2e10-…` | `msg-init-01` | init | — | completed | — | lsp.example.com | `msg-init-01` | — |
| `a03…` | `7f3c2e10-…` | `msg-init-02` | init | — | failed | — | lsp.example.com | `msg-init-02` | `62505` |
| `a04…` | `7f3c2e10-…` | `msg-confirm-01` | confirm | `od261012a3f9c2d1` | completed | Accepted | lsp.example.com | `msg-confirm-01` | — |
| `a05…` | `7f3c2e10-…` | `msg-status-01` | status | `od261012a3f9c2d1` | completed | — | lsp.example.com | `msg-status-01` | — |
| `a06…` | `7f3c2e10-…` | `msg-track-01` | track | `od261012a3f9c2d1` | sent | — | lsp.example.com | — | — |
| `a07…` | `7f3c2e10-…` | `msg-lsp-cxl-77` | cancel | `od261012a3f9c2d1` | completed | Cancelled | lsp.example.com | `msg-lsp-cxl-77` | — |

What these rows show:

- `a03` is a re-init that the LSP rejected, so it has `error_code` set.
- `a06` is waiting for `/on_track`.
- `a07` is an unsolicited LSP cancellation, inserted directly in its final
  state.

Shared context columns on every row in this example:

- `domain = nic2004:60232`
- `country = IND`
- `city = std:080`
- `core_version = 1.2.0`
- `bap_id = bap.example.in`

## Gotchas

- Do **not** join `logistics_searches` / `init_orders` on
  `transaction_id`. They reference `ondc_transactions.id` (uuid).
- `transaction_id` is shared by many rows. Always add `action` (and
  `message_id` / `order_id`) when you look one up.
- `updated_at` has no trigger. Repositories set it explicitly.
