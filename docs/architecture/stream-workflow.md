# Stream workflow (server-side SSE)

How ONDC callbacks become SSE events inside this backend, which files are involved, and the
rules for emitting events. For the frontend-facing contract (event names/payloads, how to open
a stream) see [`docs/integration/frontend-sse.md`](../integration/frontend-sse.md).

> SSE is a live delivery channel, not the source of truth. PostgreSQL is authoritative; an
> event is only a notification that authoritative state has changed.

## 1. The streams

All stream code lives in `src/utils/streams/`.

| File | Export | Endpoint | Keyed by | Status |
|---|---|---|---|---|
| `client-stream.ts` | `clientStreamManager` | `GET /logistics/stream/:clientId` | `clientId`, bound to a `transaction_id` | **Primary** — one connection for the whole lifecycle |
| `search-sse.ts` | `searchSseManager` | `GET /logistics/search/:searchId/events` | `searchId` | Legacy, per-flow |
| `order-sse.ts` | `orderSseManager` | `GET /logistics/orders/:orderId/status/events` | `orderId` | Legacy, per-flow (`order_status`, `order_tracking`) |
| `callback-stream.ts` | `createCallbackStream()` | — (wraps `clientStreamManager`) | one instance per incoming callback | Defers events until the callback's ACK is written — see §4 |

Shared limitations of every stream: in-memory, single process (no cross-instance fan-out), no
replay on reconnect or restart, events for an unbound/unconnected client are dropped
(`[client-stream] pushing event ... delivered: false`). The unified stream is last-bind-wins
per `transaction_id`.

## 2. Who does what

```
 client (frontend / src/flows/*)
   │  GET /logistics/stream/:clientId ───────────► routes/ondc.routes.ts ── clientStreamManager.subscribe()
   │  POST /logistics/search { client_id } ──────► controllers/search.controller.ts
   │                                                 └ services/search.service.ts ── clientStreamManager.bind(transaction_id, clientId)
   │  POST /logistics/init|confirm|... ──────────► request controllers → services → ONDC transport (no stream work)
   │
 workbench / LSP
   │  POST /on_<action> ─────────────────────────► callback controller (controllers/*.controller.ts)
   │                                                 └ service.handleCallback()
   │                                                    └ repository.handleCallback()  — persist, then emit
   │                                                         └ clientStreamManager.push(transaction_id, event, data)
   │                                                           (+ legacy orderSseManager / searchSseManager publish)
   ◄──────────── SSE "event: <name>" ─────────── utils/streams/client-stream.ts
```

| Layer | Files | Stream responsibility |
|---|---|---|
| Routes | `src/routes/ondc.routes.ts` | Mount the three `GET` stream endpoints (`subscribe`) |
| Binding | `src/services/search.service.ts` | `bind(transaction_id, clientId)` when `/search` mints the transaction; every later action reuses that `transaction_id`, so no re-binding |
| Callback controllers | `on-search`, `init`, `confirm`, `update`, `status`, `track`, `cancel`, `issue` controllers | Verify/validate, call `handleCallback`, write the sync ACK/NACK |
| Event producers | see §3 | Persist first, then push the normalized event |
| Delivery | `src/utils/streams/*` | Write `event:`/`data:` frames to connected subscribers |
| Consumer (automation) | `src/flows/flow-kit.ts` | `openStream()` + `waitFor(step, event)`; any `*_error` event fails the flow |

## 3. Where each event is emitted

| Callback | Event(s) on the unified stream | Emitted in | Legacy stream |
|---|---|---|---|
| `/on_search` | `search_result` (one per provider) | `services/on-search.service.ts` — `InProcessOnSearchQueue.enqueue` (async, `setImmediate`) | `searchSseManager.publish` (same place) |
| `/on_init` | `init_result` / `init_error` | `repositories/init.repository.ts` — `handleCallback` | — |
| `/on_confirm` | `order_confirmed` / `confirm_error` | `repositories/confirm.repository.ts` — `handleCallback` | — |
| `/on_update` | `order_updated` / `update_error` | `repositories/update.repository.ts` — `handleCallback` | — |
| `/on_status` | `order_status` / `status_error` | `repositories/status.repository.ts` — `handleCallback` | `orderSseManager.publish` |
| `/on_track` | `order_tracking` / `track_error` | `repositories/track.repository.ts` — `handleCallback` | `orderSseManager.publish` |
| `/on_cancel` | `order_cancelled` / `cancel_error` | `repositories/cancel.repository.ts` — `handleCallback` | `orderSseManager.publish` |
| `/on_issue` | `issue_updated` / `issue_error` | `repositories/issue.repository.ts` — `handleOnIssue` | — |
| `/on_issue_status` | `issue_status_updated` / `issue_status_error` | `repositories/issue.repository.ts` — `handleOnIssueStatus` | — |

`*_error` events mean the LSP sent a callback carrying an ONDC `error` — we still ACK it; they
are not our NACKs.

Note: `searchSseManager.complete()` (which would emit `search_completed`) exists but is not
called anywhere today.

## 4. Callback timeline and the ACK ordering rule

### Current (as of this change)

```
POST /on_init ─► validate ─► persist (DB tx) ─► push "init_result" ─► write ACK
```

The event reaches the client **before** the sender has our ACK. A client that reacts
immediately (e.g. the automation scripts firing `/confirm`) can race the ACK; `flow-kit.ts`
works around this with `FLOW_STEP_DELAY_MS`.

### Proposed (Step 2 — not wired yet)

Rule: **an event for a callback is released only after that callback's ACK has been written.**
No extra "ack sent" event is added to the stream — the existing event simply arrives later.

```
POST /on_init ─► validate ─► persist ─► stream.push("init_result")   (queued)
                                    ─► stream.releaseAfterAck(res)
                                    ─► res.json(ACK) ─► res "finish" ─► queued events flushed
```

`src/utils/streams/callback-stream.ts` provides this:

```ts
const stream = createCallbackStream();          // one per incoming callback
const result = await service.handleCallback(callback, stream);
stream.releaseAfterAck(response);               // ACK path
response.status(200).json(ondcAck(request.body));
// NACK / 503 path instead: stream.discard();
```

| Outcome of the callback | Queued events |
|---|---|
| ACK written (`finish`) | Flushed in push order |
| Socket closed before ACK finished | Discarded — the sender will retry the callback |
| We NACK / return 503 (`discard()`) | Discarded — nothing was accepted |
| `push` after release (async `/on_search` queue) | Delivered immediately |
| `push` after discard | Dropped and logged (`[callback-stream] dropping event ...`) |

`CallbackStream` has the same `push(transactionId, event, data)` signature as
`clientStreamManager`, so repositories take a `stream: CallbackStream = clientStreamManager`
parameter and existing callers keep working. Legacy per-flow streams are not deferred.

"ACK written" means Node handed the response to the socket (`finish`); ONDC has no
acknowledgement of an ACK, so this is the strongest signal the server can observe.

## 5. Adding a new event

1. Persist the authoritative state first; emit only after the DB transaction commits.
2. Push through the `CallbackStream` passed into `handleCallback` — not `clientStreamManager`
   directly — so the event respects the ACK ordering rule.
3. Push normalized fields only, never the raw ONDC payload. `transactionId` is added
   automatically.
4. Name success events by domain meaning (`order_*`) and errors `<action>_error` —
   `flow-kit.ts` treats any `*_error` event as a flow failure.
5. Add the event to the table in §3 and to `docs/integration/frontend-sse.md`.
