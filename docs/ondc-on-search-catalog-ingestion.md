# ONDC Logistics `/on_search` — Catalog Ingestion Architecture

## 1. Purpose

The `/on_search` implementation is an **asynchronous event-ingestion pipeline**.

The BAP initiates `/search`, but search results do not arrive as the direct HTTP response to that request. Logistics Seller NPs can send one or more `/on_search` callbacks through the ONDC network.

The implementation therefore separates:

- **Receiving the callback safely**
- **Durably storing the original event**
- **Processing the catalog asynchronously**
- **Persisting normalized catalog data**
- **Updating search/transaction lifecycle**
- **Streaming accepted results to the frontend through SSE**

The core architecture is:

```text
                         ONDC NETWORK
                              │
                              │ POST /on_search
                              ▼
                    ┌─────────────────────┐
                    │   ON_SEARCH WEBHOOK │
                    │                     │
                    │ Verify signature    │
                    │ Validate payload    │
                    │ Stage raw callback  │
                    └──────────┬──────────┘
                               │
                         durable commit
                               │
                              ACK
                               │
                               ▼
                    ┌─────────────────────┐
                    │       WORKER        │
                    │                     │
                    │ Correlate search    │
                    │ Parse/map catalog   │
                    │ Upsert normalized   │
                    │ Update lifecycle   │
                    │ Publish SSE        │
                    └──────────┬──────────┘
                               │
                     ┌─────────┴─────────┐
                     ▼                   ▼
                DATABASE                SSE
                                         │
                                         ▼
                                     FRONTEND
```

---

# 2. `/search` vs `/on_search`

These two endpoints have opposite directions.

### Outbound `/search`

The BAP initiates the request:

```text
Your BAP
   │
   │ /search
   ▼
ONDC Network
   │
   ▼
Logistics Seller NP
```

### Inbound `/on_search`

The network later calls the BAP:

```text
Logistics Seller NP
   │
   │ on_search
   ▼
ONDC Network
   │
   ▼
Your BAP `/on_search`
```

Therefore `/on_search` should be treated as a **webhook/callback endpoint**, not as a normal synchronous REST response handler.

---

# 3. What is a webhook?

A webhook is an HTTP endpoint exposed by one system so that another system can notify it when an event occurs.

Normal API interaction:

```text
Client → Server
        "Give me data"
```

Webhook interaction:

```text
Server → Client
        "Something happened"
```

In this project:

```text
ONDC → POST /api/logistics/on-search
```

The ONDC network is notifying the BAP that search results are available.

The webhook should therefore be:

- fast
- authenticated
- strictly validated at the contract boundary
- durable before ACK
- independent from slow catalog processing

---

# 4. Why use Webhook + Worker?

Do not process the entire catalog synchronously inside the webhook.

Avoid:

```text
POST /on_search
      │
      ├── validate
      ├── parse huge catalog
      ├── write providers
      ├── write items
      ├── write fulfillments
      ├── publish SSE
      └── ACK
```

This keeps the callback request open while potentially expensive work is performed.

Instead:

```text
POST /on_search
      │
      ├── verify
      ├── validate
      ├── durably stage
      └── ACK
             │
             ▼
           Worker
             │
             ├── parse
             ├── normalize
             ├── persist
             └── publish SSE
```

The webhook is responsible for **safe acceptance**.

The worker is responsible for **processing**.

---

# 5. Durable staging

The complete raw callback must be stored before returning a successful ACK.

Conceptually:

```text
ONDC callback
      │
      ▼
verify
      │
      ▼
validate
      │
      ▼
persist raw payload
      │
      ▼
database commit
      │
      ▼
ACK
```

If the database write fails:

```text
ONDC callback
      │
      ▼
staging fails
      │
      ▼
do not ACK as successfully accepted
```

This prevents the dangerous situation:

```text
ACK sent
   ↓
server crashes
   ↓
callback lost
```

## Raw event data

The staging record should contain information similar to:

```text
id
transaction_id
message_id
action
bpp_id
bpp_uri
raw_payload
status
received_at
processed_at
retry_count
error
```

The exact schema should follow the application's existing persistence layer.

---

# 6. Why retain the complete raw payload?

The raw callback is the original source event.

Normalized database rows are only an interpretation of that event.

Keep:

```text
raw ONDC callback
        │
        ├── normalized catalog
        └── transaction history
```

rather than only keeping:

```text
normalized catalog
```

This provides:

- replay
- debugging
- auditability
- failure recovery
- mapper/schema evolution
- investigation of unexpected ONDC responses

Example:

```text
Old mapper
   │
   ▼
Incorrect normalized data

Fix mapper
   │
   ▼
Replay original raw callback
   │
   ▼
Correct normalized data
```

Raw payloads should be treated as effectively immutable. Processing metadata can change; the original event should not.

---

# 7. Worker staging reference

The webhook does not need to send the entire catalog through the worker queue.

After staging:

```text
webhook_events
    │
    │ event ID = 789
    ▼
queue / worker trigger
    │
    │ { stagingEventId: 789 }
    ▼
worker
```

The worker then loads event `789` and retrieves the original raw payload.

This is useful when `/on_search` contains a large catalog.

---

# 8. Callback signature verification

Before processing the callback:

```text
HTTP request
     │
     ▼
Authorization / signature verification
     │
     ├── valid → continue
     └── invalid → reject
```

The verification responsibility should be isolated behind:

```text
OnSearchSignatureVerifier
```

The webhook should not parse catalog data before the callback has passed the authentication boundary.

---

# 9. Contract validation

After authentication, validate the ONDC contract.

Contract-critical fields include:

```text
context.action === "on_search"
transaction_id
message_id
BPP identity
timestamp
message/catalog
provider structure
required logistics relationships
```

Validation should distinguish between:

### Required / contract-critical

Reject if invalid or missing.

### Optional ONDC fields

Do not reject a valid callback merely because an optional field is absent.

The goal is:

```text
strict where correctness requires it
flexible where ONDC allows optionality
```

---

# 10. Context and transaction correlation

The original `/search` creates a transaction.

Example:

```text
/search
transaction_id = T123
```

Later:

```text
/on_search
transaction_id = T123
```

The callback must be correlated to the existing search transaction.

Conceptually:

```text
incoming transaction_id
        │
        ▼
ondc_transactions
        │
        ▼
original search
        │
        ▼
searchId
```

BPP identity is also important because one search may receive responses from multiple BPPs:

```text
transaction T123

BPP A → on_search
BPP B → on_search
BPP C → on_search
```

---

# 11. Callback idempotency

The same callback may be delivered more than once.

A callback identity should therefore use an idempotency key such as:

```text
(transaction_id, message_id, bpp_id)
```

with an appropriate database unique constraint.

Example:

```text
first callback
    ↓
INSERT
    ↓
processed

duplicate callback
    ↓
same unique key
    ↓
already accepted
    ↓
ACK safely
```

Idempotency must prevent both:

- duplicate normalized catalog rows
- duplicate SSE events

The database constraint is an important final protection against race conditions between workers.

---

# 12. Paginated callbacks

Do not assume:

```text
one /search → one /on_search
```

A search may result in multiple callbacks/pages:

```text
transaction T123
    │
    ├── on_search page 1
    ├── on_search page 2
    ├── on_search page 3
    └── on_search from another BPP
```

Each accepted callback should be independently staged and processed.

The normalized database represents the accumulated catalog state.

---

# 13. Normalized catalog ingestion

The raw ONDC catalog should be mapped into the application's internal `lsp_*` model.

Conceptually:

```text
ONDC on_search payload
        │
        ▼
OnSearch mapper
        │
        ├── providers
        ├── categories
        ├── locations
        ├── fulfillments
        ├── catalog items
        ├── static terms
        └── relationships
        │
        ▼
normalized lsp_* tables
```

The application should not need to understand deeply nested ONDC structures every time it reads a search result.

Use a clear boundary:

```text
ONDC contract
      ↓
mapper
      ↓
domain/application model
      ↓
database
```

---

# 14. Upsert instead of blind insert

Catalog callbacks can contain existing data.

Use upsert semantics:

```text
record exists?
    │
    ├── yes → update if incoming version is newer
    └── no  → insert
```

This protects against repeated callbacks and supports incremental catalog updates.

---

# 15. ONDC IDs vs internal database IDs

ONDC identifiers are external identifiers.

For example:

```text
ONDC item ID = "item-123"
```

Your database may use:

```text
id UUID
```

Do not directly place:

```text
"item-123"
```

into:

```text
parent_item_id UUID
```

Instead maintain the mapping:

```text
ONDC item ID
     │
     ▼
lsp_items
     │
     ├── id = internal UUID
     └── ondc_item_id = "item-123"
```

Then relationships use:

```text
parent_item_id = internal UUID
```

This is particularly important for parent/customization relationships.

---

# 16. Parent and customization relationships

Incoming ONDC relationships may reference items by external ONDC IDs.

If:

```text
Parent ONDC ID = P1
Child ONDC ID  = C1
```

resolve them before writing internal foreign keys:

```text
P1 → internal UUID A
C1 → internal UUID B

parent_item_id = A
```

Depending on the order in which objects arrive, a two-pass ingestion strategy may be useful:

```text
Pass 1:
insert/update entities

Pass 2:
resolve relationships
```

This prevents foreign-key failures caused by processing a child before its parent exists.

---

# 17. Incremental updates and stale data

Callbacks may not arrive in chronological order.

Example:

```text
existing catalog version = 10:05

incoming callback = 10:10
→ accept

later incoming callback = 10:02
→ reject/ignore as stale
```

Conceptually:

```text
if incoming.updated_at > existing.updated_at:
    update
else:
    keep existing
```

The exact timestamp/version semantics must follow the ONDC contract and your chosen catalog version field.

This prevents delayed callbacks from overwriting newer state.

---

# 18. Disabled providers

A provider becoming unavailable should generally not mean deleting its historical records.

Instead:

```text
provider.active = false
```

This is a soft-deactivation model.

Benefits:

- historical records remain available
- previous transactions can still reference the provider
- debugging is easier
- reactivation is possible if supported
- application queries can simply filter inactive providers

---

# 19. Database transactions

A single callback can contain multiple providers/entities.

Where the ingestion operation needs atomicity:

```text
BEGIN

provider A
provider B
provider C
items
fulfillments
relationships

COMMIT
```

If a required operation fails:

```text
ROLLBACK
```

The important boundary is the database transaction.

Do not make SSE part of the DB transaction:

```text
DB transaction
    ↓
COMMIT
    ↓
publish SSE
```

That way the frontend is only told about normalized data after it has successfully committed.

---

# 20. SSE is a separate delivery mechanism

SSE is not how ONDC sends the callback.

There are two independent flows:

### ONDC → backend

```text
ONDC
  │
  │ POST /on_search
  ▼
Webhook
```

### Backend → frontend

```text
Frontend
  │
  │ GET /search/events
  ▼
SSE connection
  ▲
  │
worker publishes events
```

SSE is one-way:

```text
Backend ───────────────→ Frontend
```

It is appropriate for progressively delivering search results.

---

# 21. SSE result events

After a provider is successfully ingested:

```text
worker
   │
   ▼
normalized provider
   │
   ▼
SSE publisher
```

Publish a normalized event such as:

```text
event: search_result
data: {
  "searchId": "...",
  "provider": { ... }
}
```

The frontend can consume it using the browser's `EventSource` API:

```js
const eventSource = new EventSource(
  `/api/logistics/search/events?searchId=${searchId}`
);

eventSource.addEventListener("search_result", (event) => {
  const result = JSON.parse(event.data);

  setResults((previous) => [
    ...previous,
    result,
  ]);
});

eventSource.addEventListener("search_completed", (event) => {
  eventSource.close();
});
```

This allows the UI to show providers as they become available.

---

# 22. Why route SSE events using `searchId`?

Multiple users can search simultaneously.

```text
User A → searchId S1
User B → searchId S2
```

The ONDC callback may identify the transaction rather than your frontend connection directly.

Therefore:

```text
transaction_id
      ↓
search transaction
      ↓
searchId
      ↓
SSE channel
      ↓
correct frontend client
```

This prevents User A from receiving User B's search results.

---

# 23. Search TTL

An SSE connection should not remain open forever.

The search has a configured TTL:

```text
search started
      │
      ▼
accept/process callbacks
      │
      ▼
TTL reached
      │
      ▼
finalize search
```

At the end, emit:

```text
event: search_completed

data: {
  "reason": "completed"
}
```

or:

```text
event: search_completed

data: {
  "reason": "timeout"
}
```

The frontend can then close its SSE connection.

---

# 24. TTL does not make the database stop accepting callbacks

A late callback may arrive after the frontend's SSE connection has ended.

The callback should still be handled according to the webhook/worker rules:

```text
late callback
    ↓
verify
    ↓
stage
    ↓
worker
    ↓
normalize
    ↓
database
```

The frontend simply may not receive it through the original live SSE connection.

This reinforces an important principle:

> **SSE is a live delivery channel, not the source of truth.**

The database and raw event store are the source of truth.

---

# 25. Search lifecycle manager

Search state should be managed centrally rather than scattered across controllers/workers.

A lifecycle might conceptually be:

```text
SEARCH_CREATED
      ↓
SEARCH_SENT
      ↓
WAITING_FOR_RESULTS
      ↓
PROCESSING_RESULTS
      ↓
COMPLETED
```

or:

```text
WAITING_FOR_RESULTS
      ↓
TIMEOUT
```

or:

```text
PROCESSING_RESULTS
      ↓
FAILED
```

The `SearchLifecycleManager` owns these transitions and completion/TTL behavior.

---

# 26. Proposed interfaces

The implementation should use dependency injection around these responsibilities.

## `OnSearchSignatureVerifier`

```text
verify inbound ONDC callback
```

## `OnSearchStagingRepository`

```text
stage raw callback
load staged callback
update processing state
record processing errors/retries
```

## `OnSearchCallbackRepository`

```text
callback metadata
duplicate detection
callback lookup
transaction/callback association
```

## `CatalogIngestionService`

```text
ONDC catalog
     ↓
normalized catalog state
```

## `SearchLifecycleManager`

```text
search state
TTL
completion
timeout
```

## SSE publisher

Responsible for:

```text
searchId
   ↓
connected SSE clients
   ↓
publish normalized events
```

---

# 27. Why dependency injection matters

Avoid tightly coupling the core service to concrete infrastructure.

Prefer:

```ts
class OnSearchService {
  constructor(
    signatureVerifier,
    stagingRepository,
    callbackRepository,
    catalogIngestionService,
    lifecycleManager,
    ssePublisher
  ) {}
}
```

Then tests can replace those dependencies with mocks/fakes.

For example:

```text
fake staging repository
fake catalog ingestion
fake SSE publisher
```

You can test the webhook without requiring a real queue, database, or SSE connection.

---

# 28. Error classification

Errors should be classified based on where they happen.

### Invalid signature

```text
callback
 ↓
signature invalid
 ↓
reject
```

### Malformed contract

```text
callback
 ↓
validation fails
 ↓
reject
```

### Unknown correlation

If a callback cannot be associated with a valid search transaction, handle it according to the chosen ONDC error/NACK semantics rather than silently treating it as a normal catalog response.

### Infrastructure failure

For example:

```text
database unavailable
```

If the callback cannot be durably staged:

```text
do not claim successful acceptance
```

This distinction is important:

```text
business/contract rejection
        vs
infrastructure inability to accept
```

---

# 29. Retry vs replay

These are different.

## Retry

Temporary processing failure:

```text
staged event
   ↓
worker fails
   ↓
retry same event
```

## Replay

Intentional reprocessing:

```text
old raw event
   ↓
new/fixed mapper
   ↓
rebuild normalized state
```

Raw staging enables both.

---

# 30. Persistence model

The final system conceptually has three kinds of data.

### 1. Transaction data

```text
ondc_transactions
```

Answers:

> What search did we initiate and what is its lifecycle?

### 2. Callback/event data

```text
ondc_webhook_events
```

Answers:

> What exactly did ONDC send us and was it processed?

### 3. Normalized catalog

```text
lsp_*
```

Answers:

> What logistics catalog state does the application currently know?

These have different purposes and should not be treated as the same thing.

---

# 31. Full lifecycle example

Suppose the frontend starts:

```text
searchId = S1
transactionId = T1
```

Your BAP sends:

```text
POST /search
```

Later LSP A sends:

```text
POST /on_search
transaction_id = T1
message_id = M1
bpp_id = BPP_A
```

Your webhook:

```text
1. Verify signature
2. Validate payload
3. Check idempotency
4. Store raw payload
5. Commit
6. Publish staging reference
7. ACK
```

Worker:

```text
1. Load raw event M1
2. Find transaction T1
3. Resolve searchId S1
4. Extract provider A
5. Upsert provider/catalog
6. Resolve item relationships
7. Check timestamps
8. Commit DB transaction
9. Publish search_result to S1
```

Frontend:

```text
SSE receives search_result
      ↓
React state updates
      ↓
Provider appears in UI
```

Then LSP B sends another callback:

```text
M2
```

The exact same pipeline runs.

Eventually the lifecycle manager reaches the TTL:

```text
S1
 ↓
completed/timeout
 ↓
search_completed SSE
 ↓
frontend closes connection
```

---

# 32. Test strategy

The test suite should validate the architecture, not just individual functions.

### Basic callback

```text
valid callback
→ staged
→ ACK
→ worker processes
```

### Multiple providers

```text
one callback
→ multiple normalized providers
→ multiple SSE events
```

### Pagination

```text
page 1
page 2
page 3
→ all accumulated correctly
```

### Duplicate callback

```text
same callback twice
→ one normalized result
→ one SSE event
```

### Unknown transaction

```text
callback
→ no originating search
→ appropriate rejection/NACK behavior
```

### Invalid signature

```text
invalid auth
→ callback rejected
→ no staging
```

### Malformed catalog

```text
invalid provider/item
→ validation/processing failure
→ appropriate status
```

### Disabled provider

```text
disable event
→ provider.active = false
→ historical data retained
```

### Stale update

```text
newer version
→ accepted

older version
→ ignored
```

### DB failure

```text
provider A ✓
provider B ✗
→ rollback
```

### ACK ordering

This is particularly important:

```text
staging succeeds
    ↓
ACK
```

not:

```text
ACK
    ↓
staging
```

### Worker retry

```text
staged event
→ processing failure
→ retry
→ successful processing
```

### Replay

```text
old staged event
→ new mapper
→ normalized catalog regenerated
```

### SSE lifecycle

```text
provider accepted
→ search_result

TTL reached
→ search_completed
```

---

# 33. Final architecture

The implementation should ultimately look conceptually like this:

```text
                         ┌───────────────────────┐
                         │      ONDC NETWORK     │
                         └───────────┬───────────┘
                                     │
                               /on_search
                                     │
                                     ▼
                         ┌───────────────────────┐
                         │     ON_SEARCH API     │
                         │       WEBHOOK         │
                         │                       │
                         │ • signature verify    │
                         │ • contract validate   │
                         │ • idempotency         │
                         │ • durable staging     │
                         └───────────┬───────────┘
                                     │
                                commit raw
                                     │
                                     ▼
                         ┌───────────────────────┐
                         │   WEBHOOK STAGING     │
                         │                       │
                         │ raw payload           │
                         │ callback metadata     │
                         │ processing status     │
                         │ retry information     │
                         └───────────┬───────────┘
                                     │
                                  event ID
                                     │
                                     ▼
                         ┌───────────────────────┐
                         │        WORKER         │
                         │                       │
                         │ • load event         │
                         │ • correlate search   │
                         │ • map catalog        │
                         │ • upsert data        │
                         │ • resolve IDs        │
                         │ • handle versions    │
                         │ • update lifecycle   │
                         └───────────┬───────────┘
                                     │
                         ┌───────────┴───────────┐
                         ▼                       ▼
              ┌───────────────────┐    ┌──────────────────┐
              │   NORMALIZED DB   │    │   SSE PUBLISHER  │
              │                   │    │                  │
              │ lsp_providers     │    │ searchId → client│
              │ lsp_items         │    │ search_result    │
              │ lsp_locations     │    │ search_completed │
              │ lsp_fulfillments  │    └────────┬─────────┘
              │ etc.              │             │
              └───────────────────┘             ▼
                                          ┌──────────────┐
                                          │   FRONTEND   │
                                          │  EventSource │
                                          └──────────────┘
```

---

# 34. Core principles for this codebase

Keep these principles in the project documentation:

1. **The `/on_search` endpoint is a webhook, not a synchronous search response.**
2. **Never ACK before the raw callback is durably staged.**
3. **The raw callback must remain recoverable.**
4. **Catalog processing happens asynchronously in a worker.**
5. **The same callback may be delivered more than once.**
6. **Every callback must be idempotently processed.**
7. **One search may produce multiple callbacks/pages/providers.**
8. **ONDC IDs and internal DB IDs are different namespaces.**
9. **Older catalog versions must never overwrite newer state.**
10. **Disabled providers should normally be deactivated, not deleted.**
11. **SSE is for live frontend delivery, not durable storage.**
12. **The database/event store is the source of truth; SSE is a delivery channel.**
13. **SSE events must be routed using the originating `searchId`.**
14. **Search completion is controlled by the search lifecycle/TTL.**
15. **Staged events must support retry and replay.**
16. **Keep webhook, ingestion, persistence, lifecycle, and SSE responsibilities separated through interfaces.**
