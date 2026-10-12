# Database Documentation

PostgreSQL + Drizzle ORM. **23 tables**, all defined in `src/db/schema/*.ts`.
Those schema files are the source of truth for exact column lists. These
docs explain what each table is *for*, who writes it, which row shapes
appear under which conditions, and give illustrative demo rows.

> **Demo data in these docs is synthetic.** All ids, names, phone numbers
> and amounts are made up for illustration and do not come from any real
> database.

## Files in this directory

| File | Tables | ONDC APIs |
| ---- | ------ | --------- |
| [transactions.md](transactions.md) | `ondc_transactions` | every action, inbound and outbound |
| [search.md](search.md) | `logistics_searches` | `/search` |
| [on-search.md](on-search.md) | `on_search_callbacks`, `search_providers`, `search_provider_categories`, `search_provider_fulfillments`, `search_provider_items`, `search_provider_static_terms` | `/on_search` |
| [init.md](init.md) | `init_orders`, `init_order_items`, `init_order_fulfillments`, `init_order_quote_breakups`, `init_order_settlements`, `init_order_cancellation_terms`, `init_order_linked_order_items` | `/init`, `/on_init` (read back by `/confirm`) |
| [order.md](order.md) | `logistics_order` | `/confirm` → `/on_confirm`, `/status`, `/update`, `/track`, `/cancel` and their callbacks |
| [issues.md](issues.md) | `issues`, `issue_refs`, `issue_actors`, `issue_actions` | `/issue`, `/on_issue`, `/issue_status`, `/on_issue_status` (IGM) |
| [shared.md](shared.md) | `provider_locations`, `tags`, `tag_values` | used by search, init and order rows |
| [conventions.md](conventions.md) | — | design principles, column conventions, DB configuration |

## Relationship map

```text
ondc_transactions  (one row per ONDC message we send, or per unsolicited callback we receive)
│
├── logistics_searches                       FK transaction_db_id  (action = 'search' row)
│   └── on_search_callbacks                  FK search_id          (one per BPP callback)
│       └── search_providers                 FK callback_id        (one per provider PER callback)
│           ├── search_provider_categories
│           ├── search_provider_fulfillments
│           │   └── tags ─► tag_values       (owner: search_provider_fulfillment_id)
│           ├── search_provider_items        (fulfillment_row_id → fulfillments, SET NULL)
│           ├── search_provider_static_terms (never written today)
│           └── provider_locations           (owner: search_provider_row_id)
│
└── init_orders                              FK transaction_db_id  (action = 'init' row)
    │                                        2 rows per /init: snapshot_type 'init' + 'on_init'
    ├── provider_locations                   (owner: init_order_row_id)
    ├── init_order_items
    ├── init_order_fulfillments
    │   └── tags ─► tag_values               (owner: init_order_fulfillment_id)
    ├── init_order_quote_breakups
    ├── init_order_settlements
    ├── init_order_cancellation_terms
    ├── init_order_linked_order_items
    └── tags ─► tag_values                   (owner: init_order_id)

logistics_order   PK order_id (our network order id, e.g. od261012a3f9c2d1)
│                 transaction_id: plain varchar, NO FK
└── tags ─► tag_values                       (owner: logistics_order_id)

issues            issue_id unique; transaction_id / order_id: plain varchar, NO FK
├── issue_refs
├── issue_actors
└── issue_actions (append-only)
```

There are **two FK-less "islands"**: `logistics_order` and `issues`. They
join to `ondc_transactions` (and to each other) by **value** on
`transaction_id` / `order_id`, not by foreign key. Deleting an
`ondc_transactions` row therefore never cascades into orders or issues.

## Which API writes which table

| API (direction) | Inserts | Updates |
| --------------- | ------- | ------- |
| `/search` (out) | `ondc_transactions` (search), `logistics_searches` | `ondc_transactions.status` → `sent` / `failed` |
| `/on_search` (in) | `on_search_callbacks`, `search_providers` + children, `provider_locations`, `tags`, `tag_values` | search txn → `received` → `completed`; callback → `processed` |
| `/init` (out) | `ondc_transactions` (init), `init_orders` (`init`) + children | init txn → `sent` / `failed` |
| `/on_init` (in) | `init_orders` (`on_init`) + children (replaces any previous `on_init` snapshot) | init txn → `completed` / `failed` |
| `/confirm` (out) | `ondc_transactions` (confirm), `logistics_order` (upsert on `order_id`) | confirm txn → `sent` / `failed` |
| `/on_confirm` (in) | `tags` (order tags, replaced) | `logistics_order` (full column refresh), confirm txn → `completed` / `failed` |
| `/status` (out) | `ondc_transactions` (status) | → `sent` / `failed` |
| `/on_status` (in, solicited or not) | `tags` (replaced) | `logistics_order` (full refresh); a `sent` status txn → `completed` / `failed` |
| `/update` (out) | `ondc_transactions` (update), `tags` (ready_to_ship) | `logistics_order` (instructions / auth / linked order) |
| `/on_update` (in) | — | `logistics_order.state`, `awb_no`; update txn |
| `/track` (out) | `ondc_transactions` (track) | — |
| `/on_track` (in) | — | `logistics_order.tracking_*`; track txn |
| `/cancel` (out) | `ondc_transactions` (cancel) | `logistics_order.cancellation_status` → `pending` / `failed` |
| `/on_cancel` (in, solicited or not) | `ondc_transactions` (cancel) only for an unsolicited push | `logistics_order` (state, cancellation_*), cancel txn |
| `/issue` (out) | `issues` + `issue_refs` + `issue_actors` + `issue_actions` on create; one more `issue_actions` row per later action; `ondc_transactions` (issue) | `issues.status` / `level` / `last_action_id` / `rating` |
| `/on_issue`, `/on_issue_status` (in) | new `issue_actions`; `issue_actors` (resolution provider, replaced) | `issues` (status, resolution, respondents…), issue txn |
| `/issue_status` (out) | `ondc_transactions` (issue_status) | — |

## One transaction end to end (row counts)

This is a happy-path order with 2 LSPs answering `/on_search` and 1
`/status` poll:

| Table | Rows | Why |
| ----- | ---: | --- |
| `ondc_transactions` | 4 | search, init, confirm, status (one row each; the callback is recorded on the request's row) |
| `logistics_searches` | 1 | |
| `on_search_callbacks` | 2 | one per BPP |
| `search_providers` | 2+ | one per provider per callback |
| `init_orders` | 2 | `init` + `on_init` snapshots |
| `logistics_order` | 1 | |

Every re-init adds 1 `ondc_transactions` row and 2 more `init_orders`. Every
`/cancel`, `/update`, `/track` and `/issue*` call adds 1
`ondc_transactions` row.
