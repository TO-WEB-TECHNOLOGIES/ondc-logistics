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

Your /on_init callback currently acknowledges the BPP, but it does not notify the frontend. Add either:

GET /logistics/init/:transactionId/events

or:

GET /logistics/init/:transactionId

Then the frontend can display:

INIT_SENT
INIT_RECEIVED
INIT_COMPLETED
INIT_FAILED

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
