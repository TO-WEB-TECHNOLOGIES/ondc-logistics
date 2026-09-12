# ONDC Logistics `/search` — Mental Model

## Overview

The BAP sits between two independent asynchronous flows:

1. **ONDC flow:** BAP → ONDC Network → LSP → `/on_search` → BAP
2. **Frontend flow:** BAP → SSE → User

The BAP is the meeting point between these two flows.

---

## End-to-End Flow

```text
User
  │
  │ POST /logistics/search
  ▼
BAP
  │
  ├─ Validate request
  ├─ Create search ID
  ├─ Establish SSE subscription/channel
  ├─ Map internal request → ONDC /search payload
  └─ Sign request
       │
       │ signed /search
       ▼
ONDC Network / Gateway
       │
   ┌───┼───┐
   ▼   ▼   ▼
 LSP  LSP  LSP
   │   │   │
   └───┼───┘
       │
       │ /on_search
       ▼
      BAP
       │
       ├─ Validate callback
       ├─ Map/normalize response
       ├─ Persist relevant data
       └─ Publish SSE event
              │
              ▼
             User
```

---

## 1. User → BAP

The user asks the application to find logistics options.

Example application-level endpoint:

```http
POST /logistics/search
```

The request first reaches the BAP.

The BAP should:

- Validate the incoming request.
- Create a `searchId` / search session identifier.
- Establish the mechanism through which the frontend can receive streaming results.
- Map the application's internal request into the ONDC `/search` payload.
- Sign the final ONDC request.
- Send the signed `/search` request to the ONDC network.

---

## 2. BAP → ONDC Network

The BAP does **not** publish the `/search` request to the ONDC Registry.

The simplified model is:

```text
BAP
  │
  │ signed /search
  ▼
ONDC Network / Gateway
  │
  ├──► LSP A
  ├──► LSP B
  └──► LSP C
```

The Registry is involved in ONDC participant discovery/validation, but it is not the destination where the `/search` message is published.

---

## 3. `/search` → LSPs

The ONDC network routes the search request to relevant logistics providers.

Multiple LSPs can receive the search request.

Responses are asynchronous, so there should be no assumption that all LSPs respond together.

For example:

```text
10:00:01 → /search sent

10:00:02 → LSP A sends /on_search
10:00:04 → LSP C sends /on_search
10:00:07 → LSP B sends /on_search
```

---

## 4. LSP → BAP: `/on_search`

`/on_search` is an **incoming callback** to the BAP.

It is not a request that the BAP creates after receiving a response.

The simplified flow is:

```text
/search
   BAP ───────────────► ONDC Network
                          │
                          ▼
                         LSP
                          │
                          │ /on_search
                          ▼
                         BAP
```

When `/on_search` arrives, the BAP should:

1. Validate the callback.
2. Identify the corresponding search/transaction.
3. Map/normalize the ONDC response into the application's internal representation.
4. Persist relevant information.
5. Publish the result through SSE to the frontend.

---

## 5. SSE → User

SSE is **not part of ONDC**.

It is an application-level mechanism used by the BAP to stream results to the frontend.

Conceptually:

```text
BAP
 │
 │ SSE events
 ▼
User
```

A clean API model can be:

```text
POST /logistics/search
        │
        ▼
   returns searchId

GET /logistics/search/:searchId/events
        │
        ▼
   SSE connection
```

The SSE stream can receive multiple events as different LSP responses arrive.

For example:

```text
event: search_result
data: {...LSP A result...}

event: search_result
data: {...LSP C result...}

event: search_result
data: {...LSP B result...}
```

---

## 6. Search Window / Timeout

The BAP should define a search window.

The system should not interpret "no new response arrived" as proof that every LSP has responded.

Instead:

```text
Search started
     │
     ▼
Wait for /on_search responses
     │
     ├── response arrives
     │       │
     │       └──► publish SSE result
     │
     ▼
Search window / timeout reached
     │
     ▼
Publish `search_completed` SSE event
     │
     ▼
Close SSE connection
```

For example:

```text
event: search_result
data: {...}

event: search_result
data: {...}

event: search_completed
data: {
  "searchId": "...",
  "reason": "timeout"
}
```

The exact timeout should be determined from the implementation requirements rather than hardcoded into the mental model.

---

## 7. The Two Independent Async Flows

This is the most important architectural distinction.

### ONDC flow

```text
BAP
 │
 │ /search
 ▼
ONDC Network
 │
 ▼
LSP
 │
 │ /on_search
 ▼
BAP
```

### Frontend flow

```text
BAP
 │
 │ SSE
 ▼
User
```

The BAP connects these two flows.

An LSP response does not directly go to the user. It first reaches the BAP, where it can be validated, mapped, persisted, and then published as an SSE event.

---

## 8. Implementation Mental Model

The `/search` module can eventually be thought of as these responsibilities:

```text
Incoming application request
        │
        ▼
Request validation
        │
        ▼
Create search/session
        │
        ├──────────────► SSE mechanism
        │
        ▼
Internal → ONDC mapper
        │
        ▼
ONDC /search payload
        │
        ▼
Signing / transport
        │
        ▼
ONDC Network
```

And separately:

```text
ONDC /on_search callback
        │
        ▼
Callback validation
        │
        ▼
Identify search/transaction
        │
        ▼
ONDC → Internal mapper
        │
        ├──────────────► Persistence
        │
        ▼
SSE publisher
        │
        ▼
Frontend
```

---

## Key Takeaways

- `/search` is sent **from BAP into the ONDC network**.
- The ONDC Registry is **not** the destination for `/search`.
- `/on_search` is an **incoming asynchronous callback** to the BAP.
- Multiple LSPs can respond independently and at different times.
- SSE is **your application's frontend streaming mechanism**, not an ONDC protocol mechanism.
- The BAP is the bridge between ONDC callbacks and frontend SSE events.
- Do not assume that silence means all LSPs have responded.
- Use a defined search window/timeout to determine when the search is complete.
- Keep SSE concerns separate from ONDC payload mapping.
- HTTP signing/encryption can remain outside the core controller/business logic.

---

## Final Mental Model

```text
                    YOUR APPLICATION
────────────────────────────────────────────────────

 User
   │
   │ POST /logistics/search
   ▼
 BAP
   │
   ├─ Validate
   ├─ Create search/session
   ├─ Establish SSE mechanism
   ├─ Map → ONDC /search
   └─ Sign
       │
       │
       │       ONDC NETWORK
       └──────────────► Gateway
                          │
                     ┌────┼────┐
                     ▼    ▼    ▼
                    LSP  LSP  LSP
                     │    │    │
                     └────┼────┘
                          │
                       /on_search
                          │
                          ▼
                         BAP
                          │
                          ├─ Validate
                          ├─ Map/normalize
                          ├─ Persist
                          └─ Publish SSE
                                 │
                                 ▼
                                User
```

**Core idea:** ONDC handles the BAP ↔ LSP interaction; your BAP handles the User ↔ application interaction; SSE streams the asynchronously arriving LSP results from your BAP to the user.
