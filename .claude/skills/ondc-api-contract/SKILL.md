# Skill: ONDC API Contract

## Purpose

Keep ONDC Logistics wire behavior contract-first.

## Source of truth

Use the repository's authoritative ONDC Logistics contract. The project
reference is ONDC Logistics API Contract v1.2.5.

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
