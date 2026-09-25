# Emit callback SSE events only after the ACK is written

**Date:** 2026-09-25
**Type:** fix

## What changed

- Every ONDC callback controller now creates a per-request `DeferredCallbackStream`
  (`createCallbackStream()`) and passes it into `handleCallback` / `handleOnIssue` /
  `handleOnIssueStatus`:
  - **Process-then-ACK** (`/on_search`, `/on_init`, `/on_confirm`): call
    `stream.releaseAfterAck(response)` right before the ACK and `stream.discard()` on every NACK
    or 503 branch.
  - **ACK-first** (`/on_update`, `/on_status`, `/on_track`, `/on_cancel`, `/on_issue`,
    `/on_issue_status`): call `stream.releaseAfterAck(response)` right before the immediate ACK.
    The background processing's events are held until the ACK has finished writing.
- Services and repositories take an optional `stream: CallbackStream` (defaults to
  `clientStreamManager`). All 17 unified-stream pushes in repositories and the on-search queue
  now go through `stream.push` instead of `clientStreamManager.push`.
- `InProcessOnSearchQueue.enqueue` passes the stream through. Its `search_result` pushes happen
  asynchronously, so pushes made after the ACK are delivered immediately.
- Updated `docs/architecture/stream-workflow.md` §2/§4 to document the after-ACK order as the
  current behaviour.

## Why

Events used to be pushed before the controller wrote the ACK. A client reacting to e.g.
`init_result` (the automation flows firing `/confirm`) could send its next request before the
workbench/LSP had our ACK for `/on_init`. No new "ack sent" event was added; existing events
simply arrive after the ACK.

## Files

- src/controllers/{on-search,init,confirm,update,status,track,cancel,issue}.controller.ts
- src/services/{on-search,init,confirm,update,status,track,cancel,issue}.service.ts
- src/repositories/{init,confirm,update,status,track,cancel,issue}.repository.ts
- docs/architecture/stream-workflow.md

## API/contract impact

None on the ONDC wire format or the ACK/NACK bodies. SSE event names and payloads are
unchanged; only their timing moves to after the ACK. Events are no longer emitted for a callback
we NACK/503. Legacy per-flow streams (`orderSseManager`, `searchSseManager`) are not deferred.

## Validation

- `npx tsc --noEmit -p .` → exit 0
- grep: no `clientStreamManager.push` outside `src/utils/streams/`
- Scratchpad `tsx` check of `DeferredCallbackStream` with a fake response: events held before
  `finish`, flushed after it; late pushes delivered immediately; nothing emitted after
  `discard()` or when the socket closes before `finish`
- Not yet run: a live `npm run flow:*` against the deployed service
