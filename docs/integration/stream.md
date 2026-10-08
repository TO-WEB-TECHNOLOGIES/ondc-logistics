# SSE stream

All async results (search options, quote, confirmed order, status, tracking, …) reach the frontend
as [Server-Sent Events](https://developer.mozilla.org/docs/Web/API/EventSource).

## Unified stream (recommended)

```
GET /logistics/stream/{clientId}
```

- `clientId` is any unique string **you generate**, e.g. `crypto.randomUUID()`.
- Open it **before** `POST /logistics/search`, then send the same value as `client_id` in the
  search body. The backend binds the search's `transaction_id` to your `clientId`, and every
  later callback for that transaction (init, confirm, status, track, cancel, update, issue) is
  pushed to this one connection. You don't need to send `client_id` again.
- The server writes `: connected` immediately and `: heartbeat` every 25 s. These are SSE
  comments, which `EventSource` ignores.
- Every event is sent with an SSE `event:` name. The `data:` JSON always includes `event` and
  `transactionId`, plus the fields listed below.

```
event: order_status
data: {"event":"order_status","transactionId":"…","orderId":"od…","state":"In-progress","fulfillmentState":"Order-picked-up","awbNo":"…","updatedAt":"2026-10-08T10:00:00.000Z"}
```

### Event catalog

| Event | From | Payload (besides `event`, `transactionId`) |
|---|---|---|
| `search_result` | `/on_search` | `{ searchId, provider }`, one event per provider. Shape: [search.md](search.md#sse-search_result) |
| `init_result` | `/on_init` | `{ providerId, items[], fulfillments[], quote, quoteBreakups[], cancellationTerms[] }`. See [init.md](init.md#async-result-init_result) |
| `init_error` | `/on_init` | `{ code, message }` |
| `order_confirmed` | `/on_confirm` | `{ orderId, state, providerId, item, fulfillment, quote, billing, payment }`. See [confirm.md](confirm.md#async-result-order_confirmed) |
| `confirm_error` | `/on_confirm` | `{ orderId, code, message }` |
| `order_status` | `/on_status` | `{ orderId, state, fulfillmentState, awbNo, updatedAt }` |
| `status_error` | `/on_status` | `{ orderId, code, message }` |
| `order_tracking` | `/on_track` | `{ orderId, url, status, gps, locationTimestamp, path[], updatedAt }` |
| `track_error` | `/on_track` | `{ orderId, code, message }` |
| `order_cancelled` | `/on_cancel` | `{ orderId, state, fulfillmentState, awbNo, cancellationReasonId, cancellationReasonText, cancelledBy, updatedAt }` |
| `cancel_error` | `/on_cancel` | `{ orderId, code, message }` |
| `order_updated` | `/on_update` | `{ orderId, state, awbNo, updatedAt }`: only the fields present on the callback, not a diff |
| `update_error` | `/on_update` | `{ orderId, code, message }` |
| `issue_updated` | `/on_issue` | `{ issueId, orderId, newActionCount }` |
| `issue_error` | `/on_issue` | `{ issueId, orderId, code, message }` |
| `issue_status_updated` | `/on_issue_status` | `{ issueId, orderId, newActionCount }` |
| `issue_status_error` | `/on_issue_status` | `{ issueId, orderId, code, message }` |

`*_error` events mean the LSP answered the request with an ONDC error. `code` is the ONDC error
code (e.g. `60012` = tracking not yet available). Show the `message`.

Events carry the normalized fields above, never the raw ONDC payload.

### React hook

```tsx
import { useEffect, useRef } from "react";
import { API } from "./api";

type Handler = (data: any) => void;

/** Opens the unified stream once; handlers is a map of event name → callback. */
export function useLogisticsStream(clientId: string, handlers: Record<string, Handler>) {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const es = new EventSource(`${API}/logistics/stream/${clientId}`);
    const names = Object.keys(ref.current);
    const listeners = names.map((name) => {
      const fn = (e: MessageEvent) => ref.current[name]?.(JSON.parse(e.data));
      es.addEventListener(name, fn);
      return [name, fn] as const;
    });
    return () => {
      listeners.forEach(([n, fn]) => es.removeEventListener(n, fn));
      es.close();
    };
  }, [clientId]);
}

// clientId: generate once per session and keep it across reloads (see README gotcha 4)
export const getClientId = () => {
  let id = sessionStorage.getItem("clientId");
  if (!id) sessionStorage.setItem("clientId", (id = crypto.randomUUID()));
  return id;
};
```

Usage:

```tsx
useLogisticsStream(clientId, {
  search_result: ({ provider }) => setProviders((p) => [...p, provider]),
  init_result: (quote) => setQuote(quote),
  init_error: ({ message }) => setError(message),
  order_confirmed: (order) => setOrder(order),
  order_status: (s) => setStatus(s),
});
```

`EventSource` reconnects on its own after a network drop. **Nothing sent while it was
disconnected is replayed**, so after a reconnect, re-read state from the GET endpoints
(`/logistics/search/:searchId/options`, `/logistics/orders/:orderId/status`, `/logistics/orders/:orderId/track`).

## Older per-resource streams

These still work. They are useful when you only have an id (e.g. an order-details page opened
later):

| Stream | Events |
|---|---|
| `GET /logistics/search/{searchId}/events` | `search_result` `{ event, searchId, provider }` |
| `GET /logistics/orders/{orderId}/status/events` | `order_status`, `order_tracking` |

Notes on the per-order stream:
- A confirmed cancellation arrives here as an **`order_status`** event (not `order_cancelled`),
  with `cancellationReasonId`, `cancellationReasonText` and `cancelledBy` filled in.
- `order_updated`, the `*_error` events, and IGM events are **only** on the unified stream.
- Payloads have no `transactionId`.

## Limitations

- In-memory and single-process. Nothing is replayed, and a backend restart drops all streams and
  bindings.
- No "search completed" event. `search_completed`/`search_error` exist as types but are never sent.
