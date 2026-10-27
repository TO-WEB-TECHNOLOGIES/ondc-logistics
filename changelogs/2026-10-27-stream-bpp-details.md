# Stream events: LSP details, terms and full quote context

**Date:** 2026-10-27
**Type:** feature

## What changed

- `search_result` adds `bpp`, built from `catalog["bpp/descriptor"]`:
  - `name`: the LSP name
  - `terms`: `bpp_terms` flattened to `{ code: value }` (`static_terms`,
    `static_terms_new`, `effective_date`)
  - `tags`: the raw tags

  `provider.fulfillments[].tags` now carries all fulfillment tags, not only
  the distance fields. Existing fields are unchanged.
- `init_result` is built by the new `buildInitResultEvent`
  (`src/mappers/init-result-event.mapper.ts`). It adds:
  - `bppId`, `bppUri`, `providerLocationIds`
  - per item: `categoryId`, `descriptorCode`, `time`
  - per fulfillment: `start`/`end` (gps, address, contact, time,
    instructions), raw `tags`, and `riderCheck`
    (`rider_check.inline_check_for_rider`)
  - `payment` (type, collectedBy, collectionAmount, and `settlementDetails`
    only when the LSP sends them)
  - `bppTerms` (order `bpp_terms` flattened) and raw order `tags`

  Existing fields are unchanged. Empty values are left out, never sent as
  `null` or `{}`.
- New `src/utils/ondc-tags.ts` (`normalizeTags`, `tagListToRecord`).

## Why

The LSP name, the LSP's static terms, the order liability terms and the
rider-availability check were received but never reached the app, so options
and quotes couldn't be compared or reviewed before `/confirm`.

## Files

- src/utils/ondc-tags.ts (new)
- src/mappers/init-result-event.mapper.ts (new)
- src/services/on-search.service.ts
- src/repositories/on-search.repository.ts
- src/repositories/init.repository.ts
- src/types/search/internal.ts

## API/contract impact

- ONDC wire: none.
- App-facing stream: adds fields only.

## Validation

- `npx tsc --noEmit`: passed.
- `npm run build`: passed.
- Scratch script (not committed) ran the contract sample `on_search.json`
  through `InProcessOnSearchQueue.enqueue` (with a fake repository and
  stream), and `on_init.json` through `extractInitOrder` +
  `buildInitResultEvent`. The `search_result` event had `bpp.name`
  "LSP Aggregator Inc" and the three `bpp.terms`. `init_result` had
  `bppId`/`bppUri`, the `start`/`end` sides, `riderCheck: "yes"`, `payment`
  and the six `bppTerms`. `normalizeProvider` fulfillment tags were not
  exercised, because the repository was faked.
