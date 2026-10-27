# Search: dimensions optional for Immediate Delivery

**Date:** 2026-10-27
**Type:** feature

## What changed

- `POST /logistics/search` accepts a request with no `payload.dimensions` when
  `category_id` is `Immediate Delivery`. Every other category still requires
  dimensions, and returns 400 `payload.dimensions is required unless
  category_id is Immediate Delivery` without them. If dimensions are sent,
  `length`, `breadth` and `height` are all still required.
- When dimensions are omitted, the ONDC `/search` `@ondc/org/payload_details`
  has no `dimensions` key, and the `logistics_searches` dimension columns stay
  null. Those columns were already nullable, so there is no migration.
- Swagger for `/logistics/search` updated.

## Why

Contract footnote 27: package dimensions are mandatory for intercity shipments
and optional for hyperlocal. This deployment only uses Immediate Delivery,
which is hyperlocal, for food orders.

## Files

- src/utils/search-validation.ts
- src/types/search/internal.ts
- src/types/search/ondc.ts
- src/mappers/search.mapper.ts
- src/repositories/search.repository.ts
- src/controllers/search.controller.ts

## API/contract impact

- ONDC wire: an Immediate Delivery `/search` may omit `payload_details.dimensions`,
  which the contract allows for hyperlocal.
- REST API: more lenient for Immediate Delivery only; other categories are
  unchanged. No change for existing callers.

## Validation

- `npx tsc --noEmit`: passed.
- `npm run build`: passed.
- Scratch script (not committed) ran `parseMinimalSearchRequest` and
  `mapSearchRequestToOndc`:
  - Immediate Delivery without dimensions: accepted, no `dimensions` key
  - Standard Delivery without dimensions: 400
  - Immediate Delivery with partial dimensions: 400
  - Immediate or Standard Delivery with full dimensions: unchanged
