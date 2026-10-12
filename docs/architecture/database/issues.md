# IGM tables: `issues`, `issue_refs`, `issue_actors`, `issue_actions`

Schema: `src/db/schema/issue.schema.ts`
Written by: `src/repositories/issue.repository.ts`, with payloads built in `src/mappers/issue.mapper.ts`; categories in `src/constants/issueCategories.ts`
Read by: `GET /logistics/issues/:issueId`, `GET /logistics/orders/:orderId/issues`

These tables store ONDC Issue & Grievance Management tickets that **we**
(the LBNP) raise against an LSP for a confirmed order. We are the
complainant and the LSP is the respondent. Each `/issue`, `/issue_status`
call and each solicited callback also gets an `ondc_transactions` row
(`action = 'issue'` / `'issue_status'`); see [transactions.md](transactions.md).

```text
issues (1 per ticket, issue_id unique)
├── issue_refs     what the issue is about: ORDER / PROVIDER / FULFILLMENT / ITEM
├── issue_actors   who is involved: complainant + the LSP's resolution provider, support, GROs
└── issue_actions  append-only history of every action from either side
```

`issues.transaction_id` / `order_id` are plain varchars with **no FK**.
They join to `logistics_order.order_id` by value.

---

## `issues`

**Role:** one row per ticket, holding its current status.

| Column | Meaning |
| ------ | ------- |
| `issue_id` | Our ONDC `issue.id` (`generateIssueId()` → `iss` + `yymmdd` + 8 hex). Unique. |
| `transaction_id`, `order_id`, `bpp_id`, `bpp_uri` | The order the issue is about. |
| `category_code` | Our internal category, e.g. `DELIVERY_DELAY`, `ITEM_MISSING`, `PACKAGING_ISSUE`, `CANCEL_NO_RESPONSE` (auto-raised only). |
| `descriptor_code` | The ONDC sub-category on the wire. IGM 1.0.0 codes look like `ITM01` / `ORD03`. Older rows may hold 2.0-style `ITM001`. |
| `status` | **Ours**: `OPEN` → `CLOSED`. Only our own `CLOSE` action sets `CLOSED`; a callback can also update it. |
| `level` | `ISSUE` → `GRIEVANCE` (after our `ESCALATE`) → `DISPUTE`. |
| `short_desc`, `long_desc`, `additional_desc_url/_content_type` | Complaint text and an optional image or document. |
| `respondent_ids` (`varchar[]`) | From callbacks. |
| `expected_response_duration` / `_resolution_duration` | e.g. `PT2H` / `P1D`. |
| `last_action_id` | The latest action id (ours or theirs). |
| `resolution_action_triggered`, `resolution_short_desc`, `resolution_long_desc`, `resolution_refund_amount` | Set once the LSP proposes or executes a resolution. |
| `resolution_support_chat_link` | From `resolution_provider.respondent_info.resolution_support`. |
| `rating` | `THUMBS-UP` / `THUMBS-DOWN`, sent with our `CLOSE`. |

| Condition | `status` | `level` | resolution_* | rating |
| --------- | -------- | ------- | ------------ | ------ |
| Just raised | OPEN | ISSUE | null | null |
| LSP acknowledged / processing | OPEN | ISSUE | null | null |
| LSP resolved (e.g. refund) | OPEN | ISSUE | set | null |
| We escalated (not satisfied) | OPEN | GRIEVANCE | set or null | null |
| We closed it | CLOSED | unchanged | as before | set if given |

Once `CLOSED`, the service refuses further complainant actions.

| issue_id | order_id | category_code | descriptor_code | status | level | last_action_id | resolution_action_triggered | resolution_refund_amount | rating |
| -------- | -------- | ------------- | --------------- | ------ | ----- | -------------- | --------------------------- | -----------------------: | ------ |
| `iss261012b7e04c55` | `od261012b0c1d2e3` | DELIVERY_DELAY | ORD03 | CLOSED | ISSUE | complainant-1 | REFUND | 59.00 | THUMBS-UP |
| `iss261012c1a2b3c4` | `od261012c4d5e6f7` | ITEM_MISSING | ITM01 | OPEN | GRIEVANCE | complainant-1 | — | — | — |

---

## `issue_refs`

**Role:** what the issue refers to. These are written once, on create.

| Column | Meaning |
| ------ | ------- |
| `ref_type` | `ORDER` (always), `PROVIDER`, `FULFILLMENT`, `ITEM` (and `RESOLUTIONS` where the spec uses it). |
| `ref_id` | The referenced id. |
| `quantity_count` | `ITEM` refs only: the affected quantity. |

| issue | ref_type | ref_id | quantity_count |
| ----- | -------- | ------ | -------------: |
| `iss…c55` | ORDER | od261012b0c1d2e3 | — |
| `iss…c55` | PROVIDER | P1 | — |
| `iss…c55` | FULFILLMENT | 1 | — |
| `iss…3c4` | ITEM | I1 | 1 |

---

## `issue_actors`

**Role:** the parties to the issue. Unique `(issue_id, actor_id)`.

| `actor_id` | `actor_type` | Written when | Lifetime |
| ---------- | ------------ | ------------ | -------- |
| `complainant` | COMPLAINANT | `/issue` create (our complainant_info) | permanent |
| `resolution-provider` | from `respondent_info.type`, default `RESOLUTION-PROVIDER` | a callback carries `resolution_provider` | **replaced** on every callback that carries it |
| `resolution-support` | RESOLUTION-SUPPORT | if `resolution_support.contact` is present | replaced likewise |
| `gro-0`, `gro-1`, … | `gro_type` (e.g. `INTERFACING-NP-GRO`), default `GRO` | one per GRO listed | replaced likewise |

| issue | actor_id | actor_type | org_name | person_name | contact_phone | contact_email |
| ----- | -------- | ---------- | -------- | ----------- | ------------- | ------------- |
| `iss…c55` | complainant | COMPLAINANT | — | Ops Desk | 9800000010 | ops@bap.example.in |
| `iss…c55` | resolution-provider | INTERFACING-NP | Example Logistics | Ravi K | 9800000020 | support@lsp.example.com |
| `iss…c55` | resolution-support | RESOLUTION-SUPPORT | — | — | 9800000021 | help@lsp.example.com |
| `iss…c55` | gro-0 | INTERFACING-NP-GRO | — | Anita S | 9800000022 | gro@lsp.example.com |

---

## `issue_actions`

**Role:** the full action timeline. **Append-only**: rows are never
updated. New callback actions are inserted only if their `action_id` isn't
already stored. Unique `(issue_id, action_id)`. Every outbound `/issue`
rebuilds its `actions[]` array from these rows.

Two wire shapes are supported:

| Shape | `action_id` | `side` | Actor columns |
| ----- | ----------- | ------ | ------------- |
| IGM `issue_actions.{complainant_actions,respondent_actions}[]` (current traffic) | synthesized `complainant-<i>` / `respondent-<i>` | `complainant` / `respondent` | inline `updated_by` → `actor_org_name`, `actor_person_name`, `actor_phone`, `actor_email` |
| Flat `actions[]` sample shape | the payload's own id (`A1`, `A2`…) | null | `action_by` (actor id) + `actor_details_name` |

`descriptor_code` values:

- complainant (what we send): `OPEN`, `ESCALATE`, `CLOSE`
- respondent: whatever the LSP sends is stored verbatim. The code
  branches only on `PROCESSING` and `RESOLVED`. Older 2.0-style traffic
  may carry e.g. `INFO_REQUESTED` / `RESOLUTION_PROPOSED`. A missing code
  is stored as `UNKNOWN`.

`cascaded_level` is copied from the payload when present.

A typical resolved-and-closed ticket:

| action_id | side | descriptor_code | short_desc | updated_at | actor_org_name |
| --------- | ---- | --------------- | ---------- | ---------- | -------------- |
| complainant-0 | complainant | OPEN | Delivery delayed by 3 hours | 10:00 | bap.example.in |
| respondent-0 | respondent | PROCESSING | Looking into it | 10:20 | Example Logistics |
| respondent-1 | respondent | RESOLVED | Delivery fee refunded | 13:05 | Example Logistics |
| complainant-1 | complainant | CLOSE | Resolved, thanks | 13:30 | bap.example.in |

An escalated ticket instead has `complainant-1 = ESCALATE`, and
`issues.level` becomes `GRIEVANCE`.

## Gotchas

- An action's `updated_at` is the **payload's** timestamp. `created_at`
  is when we stored it.
- Unsolicited `/on_issue` / `/on_issue_status` callbacks are deduped by
  an existing `ondc_transactions` row for the same
  `(transaction_id, message_id, action)`.
- Resolution-provider actors are deleted and re-inserted on each callback
  that carries them, so their row ids are not stable.
