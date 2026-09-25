There are now two SSE mechanisms in this backend:

1. The original per-flow streams described below (`GET /logistics/search/:searchId/events`,
   `GET /logistics/orders/:orderId/status/events`) — still supported, unchanged.
2. A single unified stream, `GET /logistics/stream/:clientId`, covering the whole order
   lifecycle (search → init → confirm → status/track/cancel/update) off one connection. See
   "Unified stream" below — this is the recommended integration going forward and is what
   closes the on_init gap called out later in this document.

Both are in-memory, single-process, no Redis/queue — same limitation applies to both: nothing
is replayed on reconnect or after an API restart, and a callback that lands before the frontend
opens its stream is missed.

Server-side internals (which files emit which events, and the ACK-ordering rule) are described
in [`docs/architecture/stream-workflow.md`](../architecture/stream-workflow.md).

## Original per-flow streams

Your frontend should own the SSE connection as part of the search request lifecycle.

Current flow:

Frontend
├─ POST /logistics/search
├─ receive searchId
├─ open GET /logistics/search/:searchId/events
├─ receive search_result events
└─ user selects provider/item/fulfillment
└─ POST /logistics/init

Example React hook:

import { useEffect, useState } from "react";

export function useSearchEvents(searchId?: string) {
const [providers, setProviders] = useState<any[]>([]);
const [status, setStatus] = useState("connecting");
const [error, setError] = useState<string | null>(null);

    useEffect(() => {
      if (!searchId) return;

      const events = new EventSource(
        `http://localhost:3000/logistics/search/${searchId}/events`
      );

      events.onopen = () => setStatus("connected");

      events.addEventListener("search_result", (event) => {
        const data = JSON.parse(event.data);
        setProviders((current) => [...current, data.provider]);
      });

      events.addEventListener("search_completed", (event) => {
        const data = JSON.parse(event.data);
        setStatus(data.reason);
        events.close();
      });

      events.addEventListener("search_error", (event) => {
        const data = JSON.parse(event.data);
        setError(data.message);
        setStatus("failed");
        events.close();
      });

      events.onerror = () => {
        setStatus("disconnected");
        events.close();
      };

      return () => {
        events.close();
      };
    }, [searchId]);

    return { providers, status, error };

}

Use it in the search page:

const [searchId, setSearchId] = useState<string>();

const startSearch = async () => {
const response = await fetch(
"http://localhost:3000/logistics/search",
{
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify(searchRequest),
}
);

    const result = await response.json();
    setSearchId(result.searchId);

};

const { providers, status, error } = useSearchEvents(searchId);

The important issue with the current backend is that SSE events are stored only in memory and are not replayed. If /on_search
arrives before the frontend opens SSE, the frontend can miss that result. Also, restarting the API loses all active
subscribers.

For development, opening SSE immediately after receiving searchId is acceptable. For production, add one of these:

- Store recent events by searchId and replay them when SSE connects.
- Add a GET /logistics/search/:searchId/results endpoint and let the frontend fetch existing results after opening SSE.
- Add a search status/results endpoint and use SSE only for live updates.

The second option is the simplest safety net.

~~Your /on_init callback currently acknowledges the BPP, but it does not notify the frontend.~~
Resolved: /on_init now pushes an `init_result` (or `init_error`) event on the unified stream
described below — no separate init-specific endpoint was added, since the same clientId/stream
already covers it.

## Unified stream

`GET /logistics/stream/:clientId`

Open this once, with a freshly generated `clientId` (e.g. `crypto.randomUUID()`), before calling
`POST /logistics/search`. Pass that same id as `client_id` in the `/search` request body — the
backend binds it to the search's `transaction_id` there, and every later callback for that
transaction (on_search, on_init, on_confirm, on_status, on_track, on_cancel, on_update) is
pushed to this one connection. You do not need to reopen the stream or pass `client_id` again
for `/init`, `/confirm`, `/status`, `/track`, `/cancel`, or `/update` — they all reuse the
transaction_id from `/search` by default.

Events carry normalized, useful fields — never the raw ONDC callback payload:

| Source callback | `event` | Payload |
|---|---|---|
| `/on_search` | `search_result` | `{ searchId, provider }` — one event per provider, same shape as `GET /logistics/search/{searchId}/options` |
| `/on_init` | `init_result` | `{ providerId, items[], fulfillments[], quote, quoteBreakups[], cancellationTerms[] }` |
| `/on_init` (error) | `init_error` | `{ code, message }` |
| `/on_confirm` | `order_confirmed` | `{ orderId, state, providerId, item, fulfillment, quote, billing, payment }` |
| `/on_confirm` (error) | `confirm_error` | `{ orderId, code, message }` |
| `/on_status` | `order_status` | `{ orderId, state, fulfillmentState, awbNo, updatedAt }` |
| `/on_status` (error) | `status_error` | `{ orderId, code, message }` |
| `/on_track` | `order_tracking` | `{ orderId, url, status, gps, locationTimestamp, path[], updatedAt }` |
| `/on_track` (error) | `track_error` | `{ orderId, code, message }` |
| `/on_cancel` | `order_cancelled` | `{ orderId, state, fulfillmentState, awbNo, cancellationReasonId, cancelledBy, updatedAt }` |
| `/on_cancel` (error) | `cancel_error` | `{ orderId, code, message }` |
| `/on_update` | `order_updated` | `{ orderId, state, awbNo, updatedAt }` — reports fields present on the callback, not a diff against the prior value |
| `/on_update` (error) | `update_error` | `{ orderId, code, message }` |

Every event also carries `transactionId`.

Example:

```js
const clientId = crypto.randomUUID();
const stream = new EventSource(`http://localhost:3000/logistics/stream/${clientId}`);

stream.addEventListener("search_result", (e) => {
  const { provider } = JSON.parse(e.data);
  // append to catalog options
});
stream.addEventListener("init_result", (e) => {
  const { quote, cancellationTerms } = JSON.parse(e.data);
  // show quote before the user confirms
});
stream.addEventListener("order_confirmed", (e) => {
  const order = JSON.parse(e.data);
  // full order summary
});
// order_status / order_tracking / order_cancelled / order_updated for post-order updates,
// plus the matching *_error events.

const startSearch = async () => {
  const response = await fetch("http://localhost:3000/logistics/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...searchRequest, client_id: clientId }),
  });
  return response.json(); // { searchId, transactionId, ... }
};
```

Known limitations (same as the per-flow streams above): single-process/in-memory only (no
Redis/pub-sub — won't fan out across multiple API instances), nothing replayed on reconnect,
and opening a second stream for the same transaction takes over delivery from the first
(last-bind-wins).

For ONDC Workbench:

1. Deploy the API to a public HTTPS URL. Workbench cannot call localhost.
2. Ensure these callback routes are publicly reachable:

POST https://your-domain.com/on_search
POST https://your-domain.com/on_init

3. Configure your environment values correctly:

BAP_ID=your-public-bap-domain
BAP_URI=https://your-domain.com
ONDC_DOMAIN=nic2004:60232
ONDC_CORE_VERSION=1.2.0

4. Open the official Workbench portal:

https://workbench.ondc.tech/home (https://workbench.ondc.tech/home)

5. Use schema validation first. Validate each protocol payload independently:

/search
/on_search
/init
/on_init

6. Then use scenario testing. Select the logistics domain and the relevant search/init scenario. Workbench will simulate the
   protocol interaction and send callbacks to your public BAP endpoints.

7. Inspect your API logs and database records:

/search sent
/on_search received
provider catalog stored
/init sent
/on_init received
init transaction completed

Workbench validates ONDC protocol behavior; it does not replace your frontend SSE connection. Your frontend SSE is an internal
UI channel, while Workbench tests the external BAP/BPP protocol interaction. ONDC describes Workbench as supporting schema
validation and scenario testing for end-to-end protocol flows. (ONDC Workbench overview
(https://github.com/ONDC-Official/automation-framework), official ONDC developer resources (https://github.com/ONDC-Official))

Also remember that ONDC requests and callbacks must be digitally signed and verified; Workbench will expose signing or payload
issues that local frontend testing will not. (ONDC signing documentation
(https://github.com/ONDC-Official/developer-docs/blob/main/registry/signing-verification.md))
