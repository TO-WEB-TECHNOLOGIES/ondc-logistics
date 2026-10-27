# search_result events carry bppId; flows pin /init to it

**Date:** 2026-10-27
**Type:** feature

## What changed

- `search_result` events now include top-level `bppId` and `bppUri`. This
  covers both the per-search SSE (`searchSseManager`) and the client stream
  (`stream.push`). The values are the `/on_search` callback's
  `context.bpp_id`/`bpp_uri`, with the same `"unknown"` fallback as
  `DrizzleOnSearchRepository.stage`, so they equal what is stored and what
  `/init` filters on. The `provider` object is unchanged.
- `SearchResultEvent` type gains `bppId` / `bppUri?`.
- Flow script `runSearchInitConfirm` (`flow-kit.ts`) sends `bpp_id` from the
  chosen `search_result` in `/init`, and logs it.

## Why

Provider, item and fulfillment IDs are only unique within one LSP's catalog.
When two LSPs return the same IDs, `/init` without `bpp_id` returns "search
option is ambiguous", and the event stream gave no way to tell the options
apart.

## Files

- src/services/on-search.service.ts
- src/types/search/internal.ts
- src/flows/flow-kit.ts

## API/contract impact

- ONDC wire: none.
- App-facing event stream: adds fields only; existing consumers are unaffected.

## Validation

- `npx tsc --noEmit`: passed.
- `npm run build`: passed.
- Not exercised end to end; no live `/on_search` was replayed.
