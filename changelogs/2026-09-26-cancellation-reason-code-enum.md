# Cancellation reason code enum

**Date:** 2026-09-26
**Type:** refactor

## What changed

- Added `CancellationReasonCode` enum (all 26 new + legacy codes in the registry table; re-numbered legacy codes carry a `_LEGACY` suffix) and `isCancellationReasonCode` guard in `constants/cancellation-reason-codes.ts`.
- Table entries' `newCode`/`currentCode` are now typed as the enum; `BNP_CANCELLATION_REASON_CODES` is `CancellationReasonCode[]` and `isValidBnpCancellationReason` is a type guard.
- `parseCancelRequest` checks enum membership first (unknown code → 400), then the BNP subset (other party's code → 400), and returns the enum type.
- `validateCancelPayload` now also rejects a non-BNP `message.cancellation_reason_id` before send.
- `CancelRequest.cancellationReasonId` and the `/cancel` mapper input are typed as the enum.
- `ondc-buyer-cancellation` flow uses `CancellationReasonCode.STORE_NOT_ACCEPTING_ORDER_LEGACY` (still `"004"`) instead of a literal.

## Why

Cancellation reason IDs were free strings; populate them from the constants and constrain them to the known code set.

## Files

- src/constants/cancellation-reason-codes.ts
- src/utils/cancel-validation.ts
- src/types/cancel/internal.ts
- src/mappers/cancel.mapper.ts
- src/flows/ondc-buyer-cancellation.flow.ts

## API/contract impact

None — wire payload unchanged (enum values are the same strings); accepted/rejected codes on `POST /logistics/cancel` unchanged. Inbound `/on_cancel` remains `string`-typed so unknown counterparty codes are still tolerated.

Known gap (not addressed): the table is the ONDC Retail registry; the Logistics contract references codes `007`, `996`, `997` that are not in it.

## Validation

- `npm run build` — passed.
- Smoke check of `parseCancelRequest` against `dist/`: `004`, `051`, `999` accepted; `002` rejected as SNP-only; `123` rejected as unknown.
