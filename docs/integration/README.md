# Frontend integration guide

Everything a frontend needs to drive this ONDC Logistics Buyer (LBNP) backend: which endpoints
to call, what to send, what comes back immediately, and what arrives later over SSE.

| Doc | Covers |
|---|---|
| [stream.md](stream.md) | The SSE stream: open it first; every async result arrives here |
| [search.md](search.md) | `POST /logistics/search`, `GET /logistics/search/:searchId/options` |
| [init.md](init.md) | `POST /logistics/init`: pick an option, get a quote |
| [confirm.md](confirm.md) | `POST /logistics/confirm`: place the order |
| [post-order.md](post-order.md) | `/status`, `/track`, `/cancel`, `/update` and the order GET endpoints |
| [igm.md](igm.md) | `/issue`, `/issue_status` (complaints / grievances) |
| [errors.md](errors.md) | Every error code and what the UI should do |
| [frontend-sse.md](frontend-sse.md) | Older notes on the SSE design and ONDC Workbench testing |

The backend's Swagger UI is at `GET /swagger` (raw spec: `GET /swagger.json`). Where Swagger and
these docs disagree, **these docs follow the actual request validators**. For example, the
`/search` Swagger block is out of date.

---

## 1. How communication works

ONDC is asynchronous. No `/logistics/*` POST returns the business result directly:

```
Frontend                    Backend (LBNP)                 LSP (logistics seller)
   │  POST /logistics/X  ──►   builds + signs ONDC /X  ──►
   │  ◄── 202 { ids }          ◄── ACK / NACK (sync)
   │                                      ...seconds later...
   │                          ◄── POST /on_X (callback)
   │  ◄── SSE event  ◄─────    persists, ACKs, pushes event
```

1. **The POST returns `202 Accepted`** once the LSP has ACKed the request. The body only holds
   identifiers (`searchId`, `transactionId`, `orderId`, …) and a `status` such as `SEARCH_SENT`.
2. **The result arrives later as an SSE event** on the stream you opened (see
   [stream.md](stream.md)). Examples: catalog options, quote, confirmed order, status, tracking.
3. **If the LSP NACKs or never answers**, the POST itself fails with `502` (`ONDC_NACK` /
   `ONDC_ACK_TIMEOUT`). An error that arrives in the callback comes as a `*_error` SSE event.

The `/on_*` routes (`/on_search`, `/on_init`, …) are ONDC callbacks called by LSPs. **The frontend
never calls them.**

## 2. The full lifecycle

```
open SSE  GET /logistics/stream/{clientId}
   │
   ▼
POST /logistics/search { client_id, … }     → 202 { searchId, transactionId }
   │  SSE: search_result  (one per provider, may be several, from several LSPs)
   ▼
POST /logistics/init { search_id, provider_id, item_id, fulfillment_id, … }
   │                                         → 202 { initId, transactionId }
   │  SSE: init_result  (quote, breakup, cancellation terms)  | init_error
   ▼
POST /logistics/confirm { initTransactionId, linkedOrder, fulfillments }
   │                                         → 202 { orderId, transactionId }
   │  SSE: order_confirmed                                    | confirm_error
   ▼
post-order, all keyed by orderId:
   POST /logistics/status   → SSE order_status
   POST /logistics/track    → SSE order_tracking
   POST /logistics/cancel   → SSE order_cancelled
   POST /logistics/update   → SSE order_updated
   POST /logistics/issue    → SSE issue_updated
   (LSPs also push order_status on their own, without a request from you)
```

The whole lifecycle shares one ONDC `transaction_id`. It is created by `/search`, reused by
`/init` and `/confirm`, and stored on the order for everything after. That is why one SSE stream,
bound at `/search`, receives every event.

## 3. Endpoint index

| Method | Path | Body naming | Success | Async result (SSE event) |
|---|---|---|---|---|
| GET | `/logistics/stream/:clientId` | – | `200` event-stream | – |
| POST | `/logistics/search` | snake_case | `202` | `search_result` |
| GET | `/logistics/search/:searchId/options` | – | `200` / `202` | – |
| GET | `/logistics/search/:searchId/events` | – | event-stream | `search_result` |
| POST | `/logistics/init` | snake_case | `202` | `init_result` / `init_error` |
| POST | `/logistics/confirm` | camelCase | `202` | `order_confirmed` / `confirm_error` |
| POST | `/logistics/status` | camelCase | `202` | `order_status` / `status_error` |
| GET | `/logistics/orders/:orderId/status` | – | `200` | – |
| GET | `/logistics/orders/:orderId/status/events` | – | event-stream | `order_status`, `order_tracking` |
| POST | `/logistics/track` | camelCase | `202` | `order_tracking` / `track_error` |
| GET | `/logistics/orders/:orderId/track` | – | `200` | – |
| POST | `/logistics/cancel` | camelCase | `202` | `order_cancelled` / `cancel_error` |
| POST | `/logistics/update` | camelCase | `202` | `order_updated` / `update_error` |
| POST | `/logistics/issue` | snake_case | `202` | `issue_updated` / `issue_error` |
| POST | `/logistics/issue_status` | snake_case | `202` | `issue_status_updated` / `issue_status_error` |
| GET | `/logistics/issues/:issueId` | – | `200` | – |
| GET | `/logistics/orders/:orderId/issues` | – | `200` | – |
| GET | `/health` | – | `200 {"status":"ok"}` | – |

> **Naming is mixed.** `/search`, `/init` and `/issue*` take **snake_case** bodies;
> `/confirm`, `/status`, `/track`, `/cancel` and `/update` take **camelCase**. Responses and
> SSE payloads are camelCase, except a few nested ONDC-shaped objects (noted per endpoint).

## 4. Conventions

- **Base URL:** whatever the API is deployed at (the flow scripts default to
  `https://logistics-render.onrender.com`; locally `http://localhost:3000`).
- **Headers:** `Content-Type: application/json`. Bodies are limited to 1 MB.
- **Auth:** none on `/logistics/*` today.
- **CORS:** not enabled yet. Until it is, call the API through a dev proxy (e.g. Vite
  `server.proxy`) or from the same origin.
- **Error body** (every non-2xx from `/logistics/*`):
  ```json
  { "error": { "code": "INVALID_INIT_REQUEST", "message": "…", "details": [{ "path": "billing.email", "message": "must be a non-empty string" }] } }
  ```
  See [errors.md](errors.md).
- **Strings vs numbers:** money and measurements accept a string or a number (`"120.00"` or `120`).
  Strings are recommended for money.

A minimal client used by the snippets in these docs:

```ts
// api.ts
export const API = import.meta.env.VITE_API_URL ?? "/api"; // e.g. a Vite proxy to the backend

export async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw Object.assign(new Error(json?.error?.message ?? res.statusText), { status: res.status, error: json?.error });
  return json as T;
}
```

## 5. Gotchas to design the UI around

1. **Open the SSE stream before `POST /logistics/search`, and pass `client_id`.** Events are not
   stored or replayed. A callback that lands while no stream is connected is lost to the UI (the
   data is still saved, so the GET polling endpoints can recover it).
2. **There is no "search finished" event.** `search_result` arrives once per provider, possibly
   from several LSPs. Show results as they arrive, and stop waiting after your own timeout
   (e.g. 30–60 s).
3. **Post-order events can arrive at any time.** LSPs push `order_status` updates on their own
   (Agent-assigned, Order-picked-up, …), not only in reply to `/status`.
4. **Keep the same `clientId` across reloads.** The backend binds `transaction_id → clientId`
   only once, at `/search`, and keeps that binding in memory. Store the `clientId` (e.g. in
   `sessionStorage`) and reopen the stream with the same id after a reload, and events keep
   flowing. A new `clientId` gets nothing for an old transaction. After a backend restart, all
   bindings are gone. In both cases, fall back to
   `GET /logistics/orders/:orderId/status/events` (keyed by orderId) or the GET polling endpoints.
5. **One stream per transaction.** Opening a second unified stream for the same transaction
   takes over delivery from the first (the last one bound wins).
