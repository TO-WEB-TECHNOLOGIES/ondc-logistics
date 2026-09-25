# Move SSE code into src/utils/streams and add the deferred callback stream

**Date:** 2026-09-25
**Type:** refactor

## What changed

- Moved every SSE file under `src/utils/` into a new `src/utils/streams/` directory, unchanged:
  `client-stream.ts`, `search-sse.ts`, `order-sse.ts`. The only code change is `search-sse.ts`'s
  type import, which gains one `../` for the new depth.
- Updated the import paths in the routes, services and repositories that use these files.
- Added `src/utils/streams/callback-stream.ts`: a `CallbackStream` interface, a
  `DeferredCallbackStream` class and a `createCallbackStream()` factory. It holds a callback's
  unified-stream events until that callback's ACK response has finished writing, and drops them
  on NACK/error. **Nothing uses it yet**; it gets wired in by the "emit after ACK" change.
- Added `docs/architecture/stream-workflow.md`, a server-side guide to the streams: which files
  bind, emit and deliver events, where each event is emitted, and the current vs. proposed
  callback/ACK timeline. Linked it from `docs/integration/frontend-sse.md`.

## Why

It groups all stream code in one place and adds the building block needed to emit callback
events only after the ACK reaches the workbench/LSP. Today the events race the ACK, and the
automation flows work around that with a fixed delay.

## Files

- src/utils/streams/client-stream.ts (moved from src/utils/)
- src/utils/streams/search-sse.ts (moved from src/utils/)
- src/utils/streams/order-sse.ts (moved from src/utils/)
- src/utils/streams/callback-stream.ts (new)
- src/routes/ondc.routes.ts
- src/services/search.service.ts
- src/services/on-search.service.ts
- src/repositories/{cancel,confirm,init,issue,status,track,update}.repository.ts
- docs/architecture/stream-workflow.md (new)
- docs/integration/frontend-sse.md

## API/contract impact

None. No change to the ONDC wire format, SSE event names/payloads/timing, the database or Redis.

## Validation

- `npx tsc --noEmit -p .` → exit 0
- grep for `utils/(client-stream|search-sse|order-sse)` outside `utils/streams/` → no matches
