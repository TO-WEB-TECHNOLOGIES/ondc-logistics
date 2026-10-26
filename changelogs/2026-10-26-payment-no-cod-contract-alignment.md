# Payment: no COD, CoD-only fields per annotated contract

**Date:** 2026-10-26
**Type:** fix

## What changed

- `/logistics/search` and `/logistics/init` reject `payment.type`
  `ON-FULFILLMENT` (cash on delivery). `/search` rejects
  `payment.collection_amount`. `/init` rejects `payment.amount`, requires
  `collected_by: BAP`, and makes `currency` optional.
- Outbound `/init` no longer sends `@ondc/org/collection_amount`. Snapshot
  rebuilds used for `/confirm` omit `collection_amount` and `collected_by`
  when they are absent, instead of sending `null`.
- `/on_init` and `/confirm` payment validation depends on the type:
  `collected_by` is required for `ON-ORDER`/`ON-FULFILLMENT`,
  `collection_amount` is required only for `ON-FULFILLMENT`, and
  `settlement_details` is optional (`settlement_type` ∈ upi/neft/rtgs when
  present). A valid prepaid `/on_init` is no longer NACKed.
- `/init` returns 400 if `payment.type` differs from the one sent in this
  transaction's `/search`.
- `/confirm` returns 409 (`CONFIRM_STATE_INVALID`) and is not sent when
  `/on_init`'s payment differs from `/init`'s: a different type or
  `collected_by`, or a CoD `collection_amount` on a non-CoD order. The
  merged payment keeps `/init`'s values and adds `/on_init`'s extras, such
  as the LSP `settlement_details` for `POST-FULFILLMENT`.
- `/init` contacts: `phone` is required for pickup and delivery; `email` is
  required for pickup and optional for delivery.
- Flow script (`flow-kit.ts`) uses `ON-ORDER` + `BAP` for both `/search` and
  `/init`, with no amount or settlement details.
- Swagger for `/logistics/init` updated.

## Why

The annotated v1.2.5 contract (Google Doc footnotes 24/25/61-64/69-70,
comments [bg]/[br]/[bt]/[bv]) says `collection_amount` is CoD-only, and
that `/init`'s payment type must match `/search`'s. The product decision is
not to offer COD.

## Files

- src/utils/init-validation.ts
- src/utils/search-validation.ts
- src/utils/confirm-validation.ts
- src/mappers/init.mapper.ts
- src/mappers/init-persistence.mapper.ts
- src/mappers/confirm.mapper.ts
- src/services/init.service.ts
- src/services/confirm.service.ts
- src/repositories/init.repository.ts
- src/controllers/init.controller.ts
- src/types/init/internal.ts
- src/flows/flow-kit.ts

## API/contract impact

- ONDC wire: prepaid `/init` and `/confirm` omit `@ondc/org/collection_amount`.
  Inbound `/on_init` validation is more lenient for prepaid and adds a
  `settlement_type` enum check.
- REST API (breaking): COD is rejected; `payment.amount` is rejected;
  `payment.currency` is optional; contact phones are required; `/init`
  payment type must match `/search`.

## Validation

- `npx tsc --noEmit`: passed.
- `npm run build`: passed.
- `npx tsx --test test/confirm-payload.snapshot.test.ts`: fails, and also
  fails without this change. The mocked `repository.create()` returns
  `undefined`, so `createConfirm` takes the idempotent-retry branch and
  never calls `sendConfirm`.
- Scratch script (not committed) checked:
  - the old body is rejected on `payment.amount`
  - COD is rejected
  - a missing delivery phone is rejected
  - the fixed body maps to `payment: {"type":"ON-ORDER","collected_by":"BAP"}`
  - prepaid and `POST-FULFILLMENT` `/on_init` are accepted
  - a bad `settlement_type` is rejected
  - the guard flags a COD switch and a `collection_amount` echo
