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
