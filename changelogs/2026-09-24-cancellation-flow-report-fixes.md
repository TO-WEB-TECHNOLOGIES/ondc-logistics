# Cancellation flow: fix remaining Pramaan report failures

**Date:** 2026-09-24
**Type:** fix

## What changed

- Flow data (`runSearchInitConfirm`):
  - The /init payment now sends one `settlement_details` entry, shaped like the contract's /init sample.
  - /confirm `start.instructions` is now `code "2"` with the PCC in `short_desc`, plus `long_desc` and `additional_desc`.
  - /confirm `end.instructions` is now `code "3"` with the DCC in `short_desc`, plus `long_desc`.
  - `linkedOrder.items[0].category_id = "Grocery"` and `linkedOrder.provider.address.country = "IND"` were added.
- The cancellation flow now uses reason `004` instead of the retail-only `051`.
- `/init` mapper: `@ondc/org/settlement_details` is left out when empty, instead of sending `[]`.
- The /on_init and /on_confirm sync ACK/NACK bodies now echo the callback's `context`. This follows the contract's /on_search ACK response sample. It uses a new `syncResponseContext` helper in `ondc-error-response.ts`.

## Why

These address the failures listed in `tasks/cancellation.md`:
- sync response `context` missing (26)
- `linked_order` `category_id` / `provider.address.country` missing (confirm, echoed in on_confirm/on_cancel)
- PCC/DCC `short_desc` over 6 characters
- empty `settlement_details` echoed back in on_init/on_cancel
- invalid cancel reason enum

The init/confirm gps failures were already fixed by the search gps fix.

The following on_cancel failures are in the LSP's payload and aren't fixed here: `provider_name`, `@ondc/org/TAT`, `collection_amount` type, `start.time.duration`.

## Files

- src/flows/flow-kit.ts
- src/flows/ondc-buyer-cancellation.flow.ts
- src/mappers/init.mapper.ts
- src/utils/ondc-error-response.ts
- src/controllers/init.controller.ts
- src/controllers/confirm.controller.ts

## API/contract impact

- /init no longer sends an empty `@ondc/org/settlement_details` array.
- The /on_init and /on_confirm sync responses now include `context`. The contract documents this only for /on_search.

## Validation

- `npx tsc --noEmit`: passed with no errors.
- Flow not re-run against Pramaan yet.
