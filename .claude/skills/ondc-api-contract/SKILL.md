# Skill: ONDC API Contract

## Purpose

Keep ONDC Logistics wire behavior contract-first.

## Source of truth

Use the repository's authoritative ONDC Logistics contract. The project
reference is ONDC Logistics API Contract v1.2.5.

## Example payloads

`examples/` holds the v1.2.5 contract's illustrative JSON payload for
each action, extracted verbatim from `docs/ondc/ondc logistics.docx`:
`lookup.json`, `vlookup.json`, `search.json`, `on_search.json`,
`init.json`, `on_init.json`, `confirm.json`, `on_confirm.json`,
`update.json`, `on_update.json`, `cancel.json`, `on_cancel.json`,
`track.json`, `on_track.json`, `status.json`, `on_status.json`.
`on_search.json`, `on_cancel.json`, and `lookup.json` contain more than
one named example (e.g. `on_cancel.json` has `standard_cancellation`
and `rto_cancellation`).

Check here first for a concrete example of an action's shape before
opening the docx. These are single illustrative examples, not the full
schema — they don't show every optional field, enum, or edge case, so
still consult the docx/contract for anything not covered here.

Two typos in the source docx's JSON were corrected here so the files
parse as valid JSON: a missing comma in `update.json`
(`start.instructions`) and a trailing comma in `on_status.json`
(`fulfillments[0].state.descriptor`). No other content was changed.

## Annotated contract source (footnotes + ONDC answers)

`docs/ondc/ondc logistics.docx` is the v1.2.5 contract **without** its
footnotes and comment threads — and those are where most enums and
required/optional rules live. The annotated original is the Google Doc:

https://docs.google.com/document/d/1CkfxtqyLbSQccJZyNmf9BSGzJBH13gcLOk_tywV-LBk/edit?tab=t.0

Fetch as plain text (public):
`curl -sL "https://docs.google.com/document/d/1CkfxtqyLbSQccJZyNmf9BSGzJBH13gcLOk_tywV-LBk/export?format=txt"`.
Footnote markers like `"type":"POST-FULFILLMENT[24]"` resolve to the
`[24] ...` list near the end; comment markers like `[bt]` resolve to the
comment threads after that (ONDC staff replies there are clarifications
of the contract).

## Payment & billing rules (from the annotated doc)

- `payment.type` enum: `ON-ORDER` (prepaid, typically thru wallet),
  `ON-FULFILLMENT` (CoD), `POST-FULFILLMENT` (post-fulfillment billing)
  — footnotes 24, 70.
- `@ondc/org/collection_amount` is CoD-only: required in `/search` for
  `ON-FULFILLMENT` (25); optional, only for `ON-FULFILLMENT`, in `/init`
  and `/on_init` (61, 69). Never send it for prepaid.
- `collected_by` required for `ON-ORDER`, `ON-FULFILLMENT` (62); for
  `POST-FULFILLMENT` it is `BAP` (comments [br]/[bt]).
- `@ondc/org/settlement_details`: LBNP provides them for CoD (63, [bv]);
  for `POST-FULFILLMENT` the LSP provides them in `/on_init` ([bv]).
  Optional until RSF is in place ([ch]); RSF does not apply to B2B —
  settled offline ([co]). `settlement_type` enum `upi` | `neft` | `rtgs`
  (`upi` → `upi_address`; `neft`/`rtgs` → `settlement_bank_account_no` +
  `settlement_ifsc_code`) (64); `beneficiary_name` belongs inside
  `settlement_details` ([bx]).
- `/init` `payment.type` must equal the `/search` `payment.type`
  ([br]/[bt]); LSP re-checks CoD eligibility at `/init` ([bo]).
- `billing` = the marketplace / LBNP entity being invoiced (55); name and
  address are what's printed on the invoice (56, 57); `tax_number` is required
  and is the LBNP GSTIN (58); `email` required (59);
  `billing.created_at <= context.timestamp` and immutable ([bk]);
  `/confirm` billing must equal `/init` (118).
- `fulfillments[].end.contact.email` is optional ([bg]); other contact
  keys follow the "mandatory unless marked optional" rule.

**Project rule: no COD.** This LBNP uses only `ON-ORDER` /
`POST-FULFILLMENT` with `collected_by: BAP`. Our `/search` and `/init`
APIs reject `ON-FULFILLMENT`; `/confirm` is blocked (409) if `/on_init`'s
payment differs from what we sent in `/init`.

The contract defines: - JSON request/response structures, - mandatory
and optional attributes, - enumerations, - expected API behavior, -
signing/verification, - registry lookup, - asynchronous request/callback
behavior.

## API map

### Pre-order

-   `/search` → `/on_search`
-   `/init` → `/on_init`
-   `/confirm` → `/on_confirm`

### Post-order

-   `/status` → `/on_status`
-   `/cancel` → `/on_cancel`
-   `/update` → `/on_update`
-   `/track` → `/on_track`

## Required checks

Before implementing an API change: 1. Find the relevant contract
section. 2. Confirm request direction. 3. Confirm callback direction. 4.
Confirm context fields. 5. Confirm transaction/message correlation. 6.
Confirm required fields. 7. Confirm enums. 8. Confirm state transitions.
9. Confirm ACK/NACK behavior. 10. Confirm retry/idempotency
requirements. 11. Confirm signature requirements. 12. Confirm whether
the proposed change affects the ONDC wire payload.

## IGM (issue & grievance) contract

IGM (`/issue` → `/on_issue`, `/issue_status` → `/on_issue_status`) is a
separate contract from the logistics one. The version this project must
implement is **IGM MVP v1.0.0**:
`tasks/ONDC API Contract for IGM_MVP_v1.0.0 - Google Docs.pdf` (the doc is
marked "deprecated" in favour of 2.0.0, but the ONDC reviewer explicitly
requires 1.0.0 Scenario 1 — see the certification sheet
`tasks/USTART (www.ustart.in) _ Buyer NP_ Logistics (B2C) - Google Sheets.pdf`).
`tasks/` is gitignored — read the PDFs from there.

Key 1.0.0 shape facts (do NOT mix with 2.0.0 — iteration 2 failed for exactly that):
- `context` follows the transaction domain's spec (contract footnote 4): domain `nic2004:60232`,
  core_version `1.2.0` (the logistics version, not the sample's retail `"1.0.0"`; Workbench's
  own /on_issue uses 1.2.0), transaction_id = the order's.
- Implemented in `src/mappers/issue.mapper.ts` (create / CLOSE / ESCALATE / issue_status);
  category → `category` + `sub_category` mapping in `src/constants/issueCategories.ts`.
- `message.issue`: `id`, `category` (`ITEM` / `FULFILLMENT`), `sub_category`
  (e.g. `ITM04`, `FLM04`), `complainant_info { person.name, contact.phone, contact.email }`,
  `order_details { id, state, items[{id, quantity}], fulfillments[{id, state}], provider_id }`,
  `description { short_desc, long_desc, additional_desc{url, content_type}, images: [url strings] }`,
  `source { network_participant_id, type: CONSUMER|SELLER|INTERFACING-NP }`,
  `expected_response_time`, `expected_resolution_time`, `status` (OPEN|CLOSED, owned by the
  buyer app), `issue_type` (ISSUE|GRIEVANCE|DISPUTE),
  `issue_actions.complainant_actions[]` (`complainant_action`: OPEN|ESCALATE|CLOSE,
  `short_desc`, `updated_at`, `updated_by { org.name = "subscriber_id::domain", contact, person }`),
  `created_at`, `updated_at`.
- No `refs[]`, `actors[]`, `actions[]`, `descriptor`, `last_action_id`, `level`, or
  `resolution_id` — those are 2.0.0.
- LSP replies: `issue_actions.respondent_actions[]` (PROCESSING, RESOLVED, CASCADED, …), a single
  `resolution { short_desc, long_desc, action_triggered, refund_amount }`, `resolution_provider`.
- Close = complainant action `CLOSE` with `status: CLOSED` (+ optional `rating`
  THUMBS-UP/THUMBS-DOWN); escalate = `ESCALATE` with `issue_type: GRIEVANCE`.
- `/issue_status` message is `{ "issue_id": "…" }`.

## Important rule

Application-domain models may differ from ONDC payloads.

Use explicit mapping: `internal model → ONDC payload` and
`ONDC payload → validated internal model`

Do not leak internal fields into the ONDC payload.

## Provider/location caution

When building `/init` or later order APIs from `/on_search` data: -
preserve provider identity, - preserve selected provider location IDs, -
preserve fulfillment IDs, - preserve item IDs, - preserve the
relationships between these objects.

Do not assume `provider.locations` is always present, and do not
fabricate a location.

If an optional application property is missing, only omit it or default
it when the contract and existing application logic permit that
behavior.
