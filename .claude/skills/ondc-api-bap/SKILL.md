---
name: ONDC API BAP Skill
description: Comprehensive knowledge base for the ONDC F&B Buyer App Platform (BAP) project. Use this skill whenever working on ONDC-related code, understanding the codebase, implementing new ONDC flows, handling schemas, processing webhooks, managing payments, or debugging ONDC integrations. This skill covers ONDC protocol flows, schema definitions, database design, service logic, SSE architecture, payment integration (HDFC/Juspay), cancellation rules, tracking, and all business rules. Trigger whenever the user mentions ONDC, RET11, BAP, BPP, /on_search, /on_select, /on_init, /on_confirm, /on_status, /on_track, /on_cancel, catalog, fulfillment, quote, payment, or anything related to this ONDC implementation.
---

# ONDC F&B BAP — Complete Project Reference

This skill is the authoritative knowledge base for the ONDC Buyer App Platform (BAP) for the F&B domain (ONDC:RET11). It covers every aspect of the implementation: ONDC protocol flows, PostgreSQL schema design, TypeScript services, SSE event architecture, HDFC/Juspay payment integration, and all business rules.

---

## 1. Project Overview

**What this project is:** A Buyer App Platform (BAP) for the ONDC (Open Network for Digital Commerce) protocol, specifically for the F&B (Food & Beverage) domain, known as ONDC:RET11.

**What it does:** Implements the buyer-side of the ONDC order flow. It allows buyers to search a catalog of restaurants/food items from multiple BPPs (seller platforms), select items, initialize orders, pay via HDFC SmartGateway (Juspay), confirm orders, track fulfillment, and cancel orders.

**Technology stack:**
- **Runtime:** Node.js with TypeScript (ESNext)
- **Web Framework:** Express.js
- **Databases:** PostgreSQL (via Drizzle ORM) for structured data; MongoDB for raw webhook audit logs
- **Cache/Queue:** Redis (sessions, SSE coordination, caching)
- **Payment:** HDFC SmartGateway via Juspay Express Checkout SDK
- **Auth:** Ed25519 digital signatures (BLAKE2b-512 digest) for ONDC protocol
- **Real-time:** Server-Sent Events (SSE) with Redis Pub/Sub for multi-instance support

**Key constants** (from `src/constants/v1/appConstants.ts`):
- `SUBSCRIBER_ID` — BAP's ONDC subscriber ID
- `DOMAIN` — Always `ONDC:RET11` (F&B)
- `CORE_VERSION` — Always `1.2.0`
- `BAP_URI` — Public callback URL for this BAP
- `GATEWAY_URL` — ONDC Gateway URL for broadcast messages
- `REGISTRY_URL` — ONDC Registry URL for BPP key lookup
- `BFF` — Buyer Finder Fee amount
- `SIGNING_PRIVATE_KEY` — Ed25519 private key for signing outbound requests
- `UNIQUE_KEY_ID` — Unique key ID for the signing key

---

## 2. Directory Structure

```
src/
├── index.ts                    # Express app entry point (port 3000)
├── constants/v1/
│   └── appConstants.ts        # All environment variables and app constants
├── controllers/               # HTTP request handlers (one file per ONDC action)
│   ├── search.controller.ts   # /search and /on_search
│   ├── select.controller.ts   # /select and /on_select
│   ├── init.controller.ts     # /init and /on_init
│   ├── confirm.controller.ts   # /confirm and /on_confirm
│   ├── status.controller.ts    # /status and /on_status
│   ├── track.controller.ts     # /track and /on_track
│   ├── cancel.controller.ts    # /cancel and /on_cancel
│   ├── stream.controller.ts    # SSE event stream (GET /stream/:clientId)
│   ├── payment.controller.ts   # HDFC payment callback
│   ├── registry.controller.ts  # BPP public key lookup
│   └── catalog.controller.ts   # Frontend catalog API
├── services/                  # Business logic layer
│   ├── search.service.ts       # Catalog broadcast, on_search processing
│   ├── select.service.ts       # /select building and on_select processing
│   ├── init.service.ts        # /init building and on_init processing
│   ├── confirm.service.ts      # /confirm building and on_confirm processing
│   ├── status.service.ts      # /status polling and on_status processing
│   ├── track.service.ts        # /track building and on_track processing
│   ├── cancel.service.ts       # /cancel building and on_cancel processing
│   ├── payment.service.ts      # HDFC/Juspay session creation and callbacks
│   ├── catalog.service.ts      # Frontend catalog queries
│   ├── registry.service.ts     # ONDC Registry BPP key lookup
│   ├── cron.service.ts         # Catalog refresh cron jobs
│   └── onboarding/v1/         # ONDC registry subscription
├── repositories/              # Data access layer (PostgreSQL)
│   ├── on-search-sql.repository.ts    # Catalog normalization
│   ├── on-select-sql.repository.ts     # /on_select storage
│   ├── init.repository.ts              # /on_init storage
│   ├── on-confirm-sql.repository.ts    # /on_confirm storage
│   ├── on-status-sql.repository.ts     # /on_status storage
│   ├── on-cancel-sql.repository.ts     # /on_cancel storage
│   └── [MongoDB models]               # Raw webhook audit logs
├── routes/                    # Express routers
│   ├── index.ts              # BPP webhook routes (/on_search, /on_select, etc.)
│   ├── search.routes.ts       # POST /api/v1/search
│   ├── select.routes.ts       # POST /api/v1/select, GET /select/result/:transaction_id
│   ├── init.routes.ts         # POST /api/v1/init
│   ├── confirm.routes.ts      # POST /api/v1/confirm, GET /confirm/status/:transaction_id
│   ├── status.routes.ts       # POST /api/v1/status, GET /status/:order_id
│   ├── track.routes.ts        # POST /api/v1/track
│   ├── cancel.routes.ts       # POST /api/v1/cancel, POST /api/v1/on_cancel
│   ├── stream.routes.ts       # GET /api/v1/stream/:clientId
│   ├── payment.routes.ts      # POST /api/v1/payment/callback
│   └── onboarding/v1/         # ONDC registry subscription routes
├── middleware/
│   └── selectSession.middleware.ts  # JWT auth for /select
├── db/
│   ├── schema/               # Drizzle ORM schema files (PostgreSQL)
│   │   ├── ondc-context.schema.ts   # Shared ONDC context (all messages)
│   │   ├── enums.ts                  # All enums
│   │   ├── bpp.schema.ts             # BPP metadata
│   │   ├── provider.schema.ts        # Provider data
│   │   ├── category.schema.ts        # Category/menu data
│   │   ├── item.schema.ts            # Item data with FK chain
│   │   ├── on-select.schema.ts       # /on_select response storage
│   │   ├── on-init.schema.ts         # /on_init response storage
│   │   ├── on-confirm.schema.ts      # /on_confirm response storage
│   │   ├── on-status.schema.ts       # /on_status response storage
│   │   ├── on-cancel.schema.ts       # /on_cancel response storage
│   │   ├── pg-transaction.schema.ts  # HDFC payment lifecycle
│   │   ├── customer/schema/          # Customer data (db2)
│   │   └── relations.ts              # Drizzle table relations
│   └── index.ts               # Database connection exports (db1, db2)
└── utils/
    ├── crypto.ts              # Ed25519 signing and BLAKE2b-512
    ├── redis.ts               # Redis client and helpers
    ├── sse-manager.ts         # SSE client management (multi-instance)
    ├── ondc-logger.ts         # Structured ONDC logging
    ├── track-timers.ts        # /track polling cron management
    ├── indian-time.ts         # India timezone (Asia/Kolkata) helpers
    ├── logger.ts              # Application logger
    ├── per-key-queue.ts       # Per-BPP queue for serializing on_search
    ├── payment/
    │   └── hdfc-client.ts     # HDFC SmartGateway/Juspay SDK wrapper
    └── v1/
        └── axios.ts           # Axios instance with interceptors
```

---

## 3. ONDC Protocol Flow

The ONDC protocol uses a synchronous request/response pattern over HTTP webhooks. All messages have a `context` object and a `message` object. The BAP (this project) acts as the client, sending requests to BPPs (sellers) and receiving callbacks (webhooks) at its public URL.

### 3.1 Full Order Flow

```
┌─────────────┐                      ┌─────────────┐                      ┌─────────────┐
│   FRONTEND  │                      │  BAP (BFF)  │                      │    BPP      │
└──────┬──────┘                      └──────┬──────┘                      └──────┬──────┘
       │                                    │                                    │
       │  POST /api/v1/search              │                                    │
       │──────────────────────────────────►│                                    │
       │                                    │  POST /api/v1/on_search (broadcast via gateway)
       │                                    │───────────────────────────────────►│
       │                                    │◄───────────────────────────────────│
       │                                    │  /on_search (catalog data)         │
       │                                    │                                    │
       │  SSE: catalog_update              │                                    │
       │◄──────────────────────────────────│                                    │
       │                                    │                                    │
       │  POST /api/v1/select               │                                    │
       │──────────────────────────────────►│                                    │
       │                                    │  POST /select (to BPP)             │
       │                                    │───────────────────────────────────►│
       │                                    │◄───────────────────────────────────│
       │                                    │  /on_select (items + quote)        │
       │  SSE: on_select                   │                                    │
       │◄──────────────────────────────────│                                    │
       │                                    │                                    │
       │  POST /api/v1/init                 │                                    │
       │──────────────────────────────────►│                                    │
       │                                    │  POST /init (to BPP)               │
       │                                    │───────────────────────────────────►│
       │                                    │◄───────────────────────────────────│
       │                                    │  /on_init (quote frozen, payment)   │
       │  SSE: on_init (+ payment_url)      │                                    │
       │◄──────────────────────────────────│                                    │
       │                                    │                                    │
       │  [Buyer completes payment on HDFC] │                                    │
       │                                    │                                    │
       │  POST /api/v1/payment/callback     │                                    │
       │──────────────────────────────────►│                                    │
       │                                    │  (auto) POST /confirm (to BPP)     │
       │                                    │───────────────────────────────────►│
       │                                    │◄───────────────────────────────────│
       │                                    │  /on_confirm (order confirmed)      │
       │  SSE: on_confirm                  │                                    │
       │◄──────────────────────────────────│                                    │
       │                                    │                                    │
       │  POST /api/v1/status (polling)     │                                    │
       │──────────────────────────────────►│                                    │
       │                                    │  POST /status (to BPP)             │
       │                                    │───────────────────────────────────►│
       │                                    │◄───────────────────────────────────│
       │                                    │  /on_status (fulfillment state)    │
       │  SSE: on_status                   │                                    │
       │◄──────────────────────────────────│                                    │
       │                                    │                                    │
       │  POST /api/v1/track (optional)     │                                    │
       │──────────────────────────────────►│                                    │
       │                                    │  [continuous polling every 5 min] │
```

### 3.2 Context Object

Every ONDC message has a `context` object:

```typescript
interface ONDCContext {
  domain: "ONDC:RET11";       // F&B domain
  country: "IND";             // India
  city: "std:080";            // City code (e.g., std:080 for Bangalore)
  action: string;             // "search" | "select" | "init" | "confirm" | "status" | "track" | "cancel"
  core_version: "1.2.0";       // ONDC core spec version
  bap_id: string;             // BAP's subscriber ID
  bap_uri: string;            // BAP's callback URL
  bpp_id: string;            // BPP's subscriber ID
  bpp_uri: string;            // BPP's endpoint URL
  transaction_id: string;     // Session ID (same across all messages in one session)
  message_id: string;        // Unique per message (for idempotency)
  timestamp: string;          // ISO8601 UTC
  ttl?: string;               // TTL for response (e.g., "PT30S")
}
```

**Important:** `transaction_id` is the session key. It stays the same across all messages in one order session. `message_id` is unique per message — used for idempotency/deduplication.

---

## 4. Database Schema Design

### 4.1 Design Philosophy

- **Queryable fields → columns; nested/semi-structured fields → JSONB**
- **Idempotency:** Unique indexes on `(bpp_id, transaction_id)` for all response tables prevent duplicate processing
- **Audit trail:** Raw webhook payloads stored in MongoDB (never used for data retrieval)
- **FK chains:** Tables reference shared `ondc_context` and prior-step tables (e.g., `on_confirm` references `on_select` and `on_init`)
- **Two databases:**
  - `db1` (PostgreSQL): ONDC catalog and order data
  - `db2` (PostgreSQL): Customer data

### 4.2 Schema Files

#### `ondc-context.schema.ts` — Shared ONDC Context
Every ONDC message is stored here first. All response tables reference `ondc_context` via `contextId FK`.

```typescript
// Key columns:
id: uuid (PK)
domain, country, city, action, coreVersion
bapId, bapUri, bppId, bppUri
transactionId, messageId
timestamp, ttl (optional)
createdAt, updatedAt

// Unique indexes:
(transaction_id, message_id)  // idempotency
// Indexes: transaction_id, message_id, bap_id, bpp_id
```

#### `enums.ts` — All Enumerations

```typescript
// Domain
domainEnum: ["ONDC:RET11"]

// Item
itemTypeEnum: ["item", "customization"]
vegNonvegEnum: ["yes", "no"]

// Fulfillment
fulfillmentTypeEnum: ["Delivery", "Self-Pickup", "Delivery and Self-Pickup", "Buyer-Delivery"]
fulfillmentStateEnum: ["Serviceable", "Non-serviceable"]
fulfillmentCategoryEnum: ["Immediate Delivery", ""]

// Payment
paymentTypeEnum: ["ON-ORDER", "ON-FULFILLMENT", "POST-FULFILLMENT"]
collectedByEnum: ["BAP", "BPP"]
paymentStatusEnum: ["PAID", "NOT-PAID"]

// Cancellation
cancellationFulfillmentStateEnum: ["Pending", "Packed", "Order-picked-up", "Out-for-delivery", "Cancelled"]

// PG (HDFC/Juspay)
pgPaymentStatusEnum: [
  "PENDING",           // Session created, buyer hasn't paid
  "CHARGED",           // Payment successful
  "PENDING_VBV",       // 3DS authentication pending
  "AUTHENTICATION_FAILED",
  "AUTHORIZATION_FAILED",
  "REFUND_PENDING",
  "REFUNDED",
  "EXPIRED",
  "CANCELLED"
]

// Order state
orderStateEnum: ["Created", "Accepted", "Pending", "Cancelled"]
fulfillmentStateCodeEnum: ["Pending", "Accepted", "Packed", "Agent-assigned", "Order-picked-up", "Out-for-delivery", "Order-delivered", "Cancelled"]

// BAP internal tracking state (SSE state machine)
bapTrackingStateEnum: [
  "pending_confirm",    // /confirm sent, waiting for /on_confirm
  "confirmed",          // /on_confirm received
  "fulfillment_pending",// /on_status: fulfillment state=Pending
  "in_delivery",        // /on_status: fulfillment state=Packed or later
  "delivered",          // Terminal
  "cancelled"           // Terminal
]
```

#### `item.schema.ts` — Catalog Item Schema with FK Chain

```
ondc_items (main item table)
  ├── provider_id      → ondc_providers.id
  ├── descriptor_id    → item_descriptor.id  (name, description, images)
  ├── price_id         → item_price.id        (currency, value, maximum_value)
  ├── quantity_id      → item_quantity.id     (available_count, maximum_count)
  │                         └── unitized_id → item_quantity_unitized.id  (unit, value)
  ├── time_id          → item_time.id         (label: enable/disable)
  ├── ondc_fields_id   → item_ondc_fields.id  (returnable, cancellable, timeToShip, etc.)
  │                         └── ondc_fields_id → item_statutory_reqs.id  (manufacturer, net_quantity, etc.)
  ├── fulfillment_id    (e.g., "F1")
  ├── location_id      (e.g., "L1")
  ├── category_id      ← ALWAYS "F&B" for ONDC:RET11 (hardcoded invariant)
  ├── category_ids     ← colon-separated "categoryId:rank" for custom_menu
  ├── tag_id           → item_tag.id
  │                         └── item_tag_list_item → (code, value pairs)
  └── is_active        (soft delete when BPP disables item)
```

#### `on-select.schema.ts` — /on_select Response Storage

```
ondc_on_select (main)
  ├── contextId FK → ondc_context.id
  ├── bppId, transactionId
  └── id unique on (bppId, transactionId)

on_select_provider (provider + primary location)
  ├── onSelectId FK
  ├── providerId, locationId
  └── locationsJson (all location IDs as JSONB array)

on_select_item (items from BPP with fulfillment_id added)
  ├── onSelectId FK
  ├── catalogItemId, fulfillmentId, locationId, parentItemId
  ├── quantityCount
  └── tags (JSONB: type, custom_group, parent)

on_select_fulfillment (fulfillment options)
  ├── onSelectId FK
  ├── fulfillmentId, type, tracking, category, tat, state
  ├── startLocationId, startGps, startContactJson, startDescriptorJson
  ├── endLocationId, endGps, endContactJson, endDescriptorJson, endAddressJson, endPersonJson
  └── tags (JSONB: weight/length/breadth/height)

ondc_on_select_quote
  ├── onSelectId FK
  ├── priceCurrency, priceValue, ttl

ondc_on_select_quote_breakup
  ├── quoteId FK
  ├── itemIdRef, itemQuantityCount, title, titleType
  ├── priceCurrency, priceValue

ondc_on_select_quote_breakup_item (nested item data)
  ├── breakupId FK
  ├── parentItemId, availableCount, maximumCount
  ├── priceCurrency, priceValue
  └── tags (JSONB: type, parent, quote, offer)

ondc_on_select_error
```

#### `on-init.schema.ts` — /on_init Response Storage

```
ondc_on_init (main)
  ├── contextId FK → ondc_context.id
  ├── onSelectId FK → ondc_on_select.id  (links to the /select that started this)
  ├── bppId, transactionId
  ├── tagsJson (bpp_terms, tax_number)
  └── id unique on (bppId, transactionId)

on_init_billing (buyer billing address)
  ├── onInitId FK
  ├── name, email, phone, taxNumber
  └── addressJson (name, building, locality, city, state, country: "IND", areaCode)

on_init_quote (frozen quote — MUST be echoed verbatim in /confirm)
  ├── onInitId FK
  ├── priceCurrency, priceValue, ttl

init_quote_breakup (quote line items)
  ├── quoteId FK
  ├── itemIdRef, itemQuantityCount, title, titleType
  ├── priceCurrency, priceValue
  └── itemJson (parent_item_id, quantity: {available, maximum}, price, tags)

on_init_payment (payment terms)
  ├── onInitId FK
  ├── buyerAppFinderFeeType, buyerAppFinderFeeAmount
  ├── settlementDetails (JSONB: settlementBasis, settlementWindow, withholdingAmount, tags)
  ├── type (paymentTypeEnum), collectedBy (BAP), status
  └── uri, (optional)

on_init_cancellation_term (cancellation rules)
  ├── onInitId FK
  ├── fulfillmentStateCode (Pending→0%, Packed/Order-picked-up/Out-for-delivery→100%)
  ├── fulfillmentStateShortDesc, reasonRequired, returnEligible
  └── cancelByDuration

on_init_cancellation_fee
  ├── cancellationTermId FK
  └── feeJson (percentage or amount)

ondc_on_init_error
```

#### `pg-transaction.schema.ts` — HDFC Payment Lifecycle

```
pg_transaction (one per ONDC transaction_id)
  ├── id (uuid PK)
  ├── onInitId FK → ondc_on_init.id
  ├── transactionId (unique index — idempotency key)
  ├── juspayOrderId (Juspay's order ID)
  ├── amount, currency
  ├── paymentPageUrl (HDFC payment page URL)
  ├── sdkPayload (HDFC SDK initialization data)
  ├── sessionInitiated (boolean)
  ├── status (pgPaymentStatusEnum: PENDING → CHARGED/FAILED)
  ├── statusMessage
  ├── callbackPayloadJson (raw HDFC callback — audit)
  ├── pgTxnId (HDFC's transaction reference)
  ├── confirmSentAt (timestamp when /confirm was auto-sent)
  ├── orderId (BAP-generated: odYYMMDD<random_hex>)
  ├── sessionCreatedAt, callbackReceivedAt, statusCheckedAt
  ├── retryCount, lastError
```

**Important:** The `confirmSentAt` column is the idempotency key that prevents duplicate `/confirm` sends. Once set, subsequent CHARGED callbacks will not trigger another `/confirm`.

#### `on-confirm.schema.ts` — /on_confirm Response Storage

```
ondc_on_confirm (main)
  ├── contextId FK → ondc_context.id
  ├── onSelectId FK → ondc_on_select.id
  ├── onInitId FK → ondc_on_init.id
  ├── pgTransactionId FK → pg_transaction.id
  ├── bppId, transactionId, orderId (BAP-generated UUID)
  ├── state (orderStateEnum: Created → Accepted/Pending/Cancelled)
  └── id unique on (bppId, transactionId)

on_confirm_provider
on_confirm_item (with tagsJson for type/parent/quote/offer)
on_confirm_billing
on_confirm_fulfillment (stores full fulfillment data from BPP)
  ├── fulfillmentId, type, tracking, category, tat, providerName
  ├── stateCode (Accepted/Pending)
  ├── startLocationId, startGps, startAddressJson, startContactJson
  ├── startTimeRangeStart/End, startTimeDays, startTimeScheduleJson
  ├── endLocationId, endGps, endAddressJson, endContactJson, endPersonJson
  ├── endTimeRangeStart/End
  ├── startInstructionsJson, endInstructionsJson
  └── tags

on_confirm_quote (echoed from /on_init — verbatim)
on_confirm_quote_breakup
on_confirm_quote_breakup_item
on_confirm_payment
  ├── buyerAppFinderFeeType, buyerAppFinderFeeAmount
  ├── type, collectedBy, status (PAID)
  ├── transactionId (HDFC pgTxnId, NOT ONDC transaction_id)
  ├── paidAmount
  └── settlementDetails (JSONB: settlementBankAccount, settlementVPA, settlementType, etc.)

on_confirm_cancellation_term
on_confirm_cancellation_fee
ondc_on_confirm_error
```

#### `on-status.schema.ts` — /on_status Response Storage

**Design:** One row per `/on_status` callback event (not an upsert). `message_id` is the idempotency key — BPP retries create new rows with new message_ids.

```
ondc_on_status (main)
  ├── contextId FK → ondc_context.id
  ├── onConfirmId FK → ondc_on_confirm.id (provides order_id, provider, items, billing, quote)
  ├── bppId, transactionId, messageId (unique per event), orderId
  ├── state (orderStateEnum: Accepted/Pending/Cancelled)
  └── receivedAt

on_status_fulfillment (primary table for order tracking)
  ├── onStatusId FK
  ├── fulfillmentId, type, tracking
  ├── stateCode (THE KEY COLUMN: Pending→Packed→Agent-assigned→Order-picked-up→Out-for-delivery→Order-delivered/Cancelled)
  ├── stateDescriptorName (human-readable: "Food Packed", "Order picked up", etc.)
  ├── tat (@ondc/org/TAT)
  ├── agentName, agentPhone, agentImageJson, vehicleRegistration
  ├── startLocationJson, startContactJson, startTimeRangeJson
  ├── startTimestamp, startInstructionsJson, startAuthorizationJson
  ├── endLocationJson, endContactJson, endPersonJson
  ├── endTimeRangeJson, endTimestamp, endInstructionsJson, endAuthorizationJson
  ├── tags (JSONB: timeline tags including tracking URL)
  └── trackingUrl (extracted from tags for buyer UI)

on_status_error
```

#### `on-cancel.schema.ts` — /on_cancel Response Storage

```
ondc_on_cancel (main)
  ├── contextId FK → ondc_context.id
  ├── onConfirmId FK → ondc_on_confirm.id
  ├── bppId, transactionId, messageId, orderId
  ├── state (always "Cancelled")
  ├── cancelledBy ("buyerNP.com" for buyer-initiated, "sellerNP.com" for BPP-initiated)
  ├── cancellationReasonId, cancellationReasonDesc
  ├── tagsJson, cancelledAt, receivedAt

on_cancel_provider
on_cancel_item (quantityCount=0 for cancelled items)
on_cancel_billing
on_cancel_fulfillment (stateCode always "Cancelled")
on_cancel_quote (updated: original value - cancellation fee)
on_cancel_quote_breakup (includes cancellation fee as negative line item)
```

---

## 5. ONDC Action Schemas (Per-Step)

### 5.1 /search → /on_search (Catalog Discovery)

**Outbound (BAP → Gateway → BPPs):**
```typescript
// POST /api/v1/search
{
  context: { domain, country, city, action: "search", ... },
  message: {
    intent: {
      fulfillment: {
        type: "Delivery" | "Self-Pickup",
        end: { location: { gps, address: { area_code } } }
      },
      payment: { type: "ON-FULFILLMENT" | "PRE-FULFILLMENT" | "ON-ORDER" }
    }
  }
}
```

**Inbound (BPP → BAP via gateway):**
```typescript
// POST /api/v1/on_search (BPP webhook)
{
  context: { action: "on_search", ... },
  message: {
    catalog: {
      "bpp/description": "...",
      "bpp/fulfillments": [...],  // Delivery/Self-Pickup configurations
      "bpp/providers": [
        {
          id, descriptor: { name, logo },
          categories: [...],        // Menu sections
          items: [...],             // Products with prices
          fulfillments: [...],
          locations: [{ id, gps, address: { area_code } }]
        }
      ]
    }
  }
}
```

**Storage:** Normalized to PostgreSQL `ondc_providers`, `ondc_categories`, `ondc_items`, etc. via `on-search-sql.repository.ts`.

**Soft-deactivation:** When a new `/on_search` arrives, items/categories NOT in the new payload are soft-deactivated (`is_active=false`) for that BPP.

### 5.2 /select → /on_select (Item Selection)

**Outbound (BAP → BPP direct):**
```typescript
// POST /api/v1/select
{
  context: { action: "select", transaction_id, ... },
  message: {
    order: {
      provider: { id, location_id },
      items: [
        { id: "item_id", quantity: { count: N } },
        { id: "customization_id", parent_item_id: "item_id", quantity: { count: N } }
      ],
      fulfillments: [{ id: "fulfillment_id", type, end: { location: { ... } } }]
    }
  }
}
```

**Inbound (BPP → BAP):**
```typescript
// POST /api/v1/on_select
{
  context: { action: "on_select", ... },
  message: {
    order: {
      provider: { id, locations: [{ id }] },
      items: [...],  // BPP echoes items with fulfillment_id added
      fulfillments: [...],
      quote: {
        price: { currency: "INR", value: "350.00" },
        breakup: [
          { title: "Item", price: "300.00" },
          { title: "Tax", price: "25.00" },
          { title: "Delivery", price: "25.00" }
        ],
        ttl: "PT30M"
      }
    }
  }
}
```

**Important business rules:**
- `transaction_id` is reused if no `/on_init` was received yet; otherwise a new one is generated
- Items without `fulfillment_id` from BPP are rejected
- Quote is FROZEN at this point — it MUST be echoed verbatim in `/init` and `/confirm`

### 5.3 /init → /on_init (Order Initialization)

**Outbound (BAP → BPP direct):**
```typescript
// POST /api/v1/init
{
  message: {
    order: {
      provider: { id, location_id },
      items: [...],
      billing: { name, email, phone, address: { ... }, tax_number? },
      fulfillment: { type, end: { contact: { phone, email }, location: { ... } } }
    }
  }
}
```

**Inbound (BPP → BAP):**
```typescript
// POST /api/v1/on_init
{
  message: {
    order: {
      provider: { id, locations: [...] },
      items: [...],
      billing: { ... },
      fulfillment: { type, ... },
      quote: {
        price: { currency: "INR", value: "350.00" },
        breakup: [...],
        ttl
      },
      payment: {
        "@ondc/org/buyer_app_finder_fee_type": "percent",
        "@ondc/org/buyer_app_finder_fee_amount": "3.0",
        "collected_by": "BAP",
        "type": "ON-ORDER",
        "status": "NOT-PAID"
      },
      cancellation_terms: [
        {
         fulfillment_state: { code: "Pending", descriptor: { name: "Pending" } },
          cancellation_fee: { percentage: "0" },  // 0% if cancelled in Pending state
          reason_required: true
        },
        {
          fulfillment_state: { code: "Packed", ... },
          cancellation_fee: { percentage: "100" },  // 100% if food already prepared
          ...
        }
      ],
      tags: [{ code: "bpp_terms", list: [...] }]
    }
  }
}
```

**Important:** After `/on_init`, the HDFC payment session is created (fire-and-forget). The quote is now frozen.

### 5.4 Payment Flow (HDFC SmartGateway / Juspay)

**Architecture:**
1. BAP receives `/on_init` → creates Juspay order session → gets HDFC payment page URL
2. Frontend redirects buyer to HDFC payment page
3. Buyer completes payment → HDFC redirects to `/payment/callback`
4. BAP verifies status via `juspay.order.status` API (never trust callback payload alone)
5. If `CHARGED` → auto-triggers `/confirm` (idempotent via `pg_transaction.confirmSentAt`)

**Juspay Order ID mapping:**
- ONDC `transaction_id` is a UUID (36 chars, e.g., `9cd6e5f9-52b7-447e-be14-ad55b8adc54b`)
- Juspay requires <18 chars → `toJuspayOrderId()` strips hyphens and takes last 16 chars: `e14-ad55b8adc54b`

**SSE Events during payment:**
- `payment_url` — contains HDFC payment page URL (redirect buyer here)
- `payment_status` — CHARGED/PENDING/FAILED/etc.
- `payment_error` — session creation failed (with retryable flag)
- `confirm_sent` — `/confirm` was sent to BPP
- `confirm_error` — `/confirm` failed

### 5.5 /confirm → /on_confirm (Order Confirmation)

**Outbound (BAP → BPP direct):**
```typescript
// POST /api/v1/confirm
{
  message: {
    order: {
      id: "od260410a3f9b2c1",  // BAP-generated: odYYMMDD<random_hex>
      state: "Created",
      provider: { id, locations: [...] },
      items: [...],
      billing: { ... },
      fulfillments: [...],
      quote: { ... },  // ECHOED VERBATIM from /on_init
      payment: {
        "@ondc/org/buyer_app_finder_fee_type": BAP_FINDER_FEE_TYPE,
        "@ondc/org/buyer_app_finder_fee_amount": BFF,
        "type": "ON-ORDER",
        "collected_by": "BAP",
        "status": "PAID",
        "transaction_id": "<HDFC pgTxnId>",  // NOT ONDC transaction_id
        "paid_amount": "<quote.price.value>"  // MUST equal on_init quote
      }
    }
  }
}
```

**Important rules:**
- Quote MUST be echoed verbatim — never modify prices
- `payment.transaction_id` is the HDFC reference (pgTxnId), NOT the ONDC transaction_id
- `payment.paid_amount` MUST equal `on_init.quote.price.value`
- Order `id` is BAP-generated (odYYMMDD<hex>), NOT the ONDC transaction_id

### 5.6 /status → /on_status (Fulfillment Polling)

**Outbound (BAP → BPP):**
```typescript
// POST /api/v1/status
{ message: { order_id: "od260410a3f9b2c1" } }
```

**Inbound (BPP → BAP):**
```typescript
// POST /api/v1/on_status
{
  message: {
    order: {
      id: "od260410a3f9b2c1",
      state: "Accepted",
      items: [...],
      fulfillments: [
        {
          id: "F1",
          type: "Delivery",
          tracking: true,
          state: {
            descriptor: { code: "Order-picked-up", name: "Order picked up" },
            updated_at: "..."
          },
          agent: { name: "Ravi", phone: "+91-9876543210", ... },
          start: { location: { gps: "12.9716,77.5946", ... }, time: { range: { start: "...", end: "..." } } },
          end: { location: { gps: "12.9352,77.6245", ... }, contact: { phone: "..." }, person: { name: "..." } }
        }
      ],
      quote: { ... },
      created_at: "...", updated_at: "..."
    }
  }
}
```

**BAP Internal Tracking State Machine:**
```
pending_confirm → confirmed → fulfillment_pending → in_delivery → delivered
                                                              ↘ cancelled (terminal)
```

State transitions based on `fulfillmentStateCode`:
- `Pending` → `fulfillment_pending`
- `Packed` | `Agent-assigned` | `Order-picked-up` → `in_delivery`
- `Order-delivered` → `delivered` (terminal, stops polling)
- `Cancelled` → `cancelled` (terminal, stops polling)

### 5.7 /track → /on_track (Live Tracking)

**Polling:** When buyer requests tracking, BAP starts a cron job that polls `/track` every 5 minutes. Polling stops when BPP returns `inactive` status (delivered/cancelled).

**Outbound (BAP → BPP):**
```typescript
// POST /api/v1/track
{ message: { order_id: "od260410a3f9b2c1" } }
```

**Inbound (BPP → BAP):**
```typescript
// POST /api/v1/on_track
{
  message: {
    tracking: {
      id: "F1",
      url: "https://track.example.com/...",  // External tracking URL
      status: "active",  // "active" | "inactive"
      location: { gps: "12.9352,77.6245" },
      tags: [
        { code: "order", list: [{ code: "id", value: "od260410a3f9b2c1" }] },
        { code: "tracking", list: [{ code: "url", value: "https://..." }] }
      ]
    }
  }
}
```

**Error handling:**
- NACK `40005` (rider not assigned / tracking disabled / delivered) → stop polling immediately
- NACK `31003` (order processing) → retry once after 5 seconds

### 5.8 /cancel → /on_cancel (Cancellation)

**Outbound (BAP → BPP):**
```typescript
// POST /api/v1/cancel
{
  message: {
    order_id: "od260410a3f9b2c1",
    cancellation_reason_id: "006",  // See VALID_CANCEL_REASON_IDS
    descriptor: {
      name: "fulfillment",
      short_desc: "F1",  // Optional: specific fulfillment ID
      tags: [{ code: "params", list: [{ code: "force", value: "no" }] }]
    }
  }
}
```

**Valid Cancellation Reason IDs:**
```typescript
const VALID_CANCEL_REASON_IDS = [
  "001",  // Price change
  "002",  // Item unavailable
  "003",  // Lower price elsewhere
  "006",  // TAT breach — no cancellation fee
  "051",  // Store not accepting order
  "052",  // Order/fulfillment not received as per O2D TAT
  "053",  // Buyer wants to modify address/other details
];
```

**Cancellation Rules:**
- `Pending` state → 0% cancellation fee (food not prepared)
- `Packed` or later → 100% cancellation fee (food prepared/in-delivery)
- `Out-for-delivery` → BPP will NACK 30014 (cannot cancel)
- `Order-delivered` → NOT cancellable

**Inbound (BPP → BAP):**
```typescript
// POST /api/v1/on_cancel
{
  message: {
    order: {
      id: "od260410a3f9b2c1",
      state: "Cancelled",
      cancellation: {
        cancelled_by: "buyerNP.com",  // or "sellerNP.com" for BPP-initiated
        reason: { id: "006", descriptor: { name: "TAT breach" } }
      },
      items: [...],  // quantity.count = 0 for cancelled items
      quote: { price: { value: "0.00" } },  // After fee deduction
      fulfillments: [...],  // State: "Cancelled"
      ...
    }
  }
}
```

---

## 6. SSE (Server-Side Events) Architecture

### 6.1 Overview

Real-time updates are delivered to the frontend via SSE. The architecture supports multiple BFF instances with Redis Pub/Sub coordination.

### 6.2 SSE Events

| Event | Trigger | Contents |
|---|---|---|
| `init_sent` | `/init` sent to BPP | transaction_id |
| `on_init` | `/on_init` received | Full /on_init payload + payment_url |
| `payment_url` | HDFC session created | session_url, sdk_payload, order_id, amount |
| `payment_status` | HDFC callback received | status (CHARGED/PENDING/etc.), pg_txn_id |
| `payment_error` | HDFC session creation failed | error_code, message, retryable |
| `confirm_sent` | `/confirm` sent | order_id, transaction_id, amount |
| `confirm_error` | `/confirm` failed | error_code, message, retryable |
| `on_confirm` | `/on_confirm` received | order_id, state, bpp_id |
| `on_status` | `/on_status` received | fulfillment state, agent info, GPS |
| `on_track` | `/on_track` received | fulfillment_id, GPS, status, tracking_url |
| `on_cancel` | `/on_cancel` received | order_id, state, cancellation details |

### 6.3 Architecture Details

```
Frontend
   │ GET /stream/:clientId (SSE connection)
   │◄─────────────────────────────────────────│
   │
   │ POST /select (with clientId in body)
   │─────────────────────────────────────────►│
   │         bindTransactionToClient(txId, clientId)
   │         (Redis: sse:tx:{txId} → clientId, TTL 24h)
   │
   │         BPP → /on_select webhook
   │         processOnSelect → pushSSEvent("on_select", ...)
   │
   │ SSE: on_select { ... }
   │◄─────────────────────────────────────────│

Multi-instance coordination:
  1. pushSSEvent checks if clientId is local (same BFF instance)
  2. If local → deliver directly (no Redis round-trip)
  3. If remote → Redis Pub/Sub broadcasts to all instances
     Owning instance delivers; others no-op (client not in local map)

Heartbeat:
  - Redis: sse:client:{clientId} → instanceId (30s TTL, refreshed every 15s)
  - If TTL expires → instance ownership lost, another instance picks up
```

### 6.4 SSE Endpoints

- `GET /api/v1/stream/:clientId` — Opens SSE stream
- Frontend must provide `clientId` when calling `/select`, `/init`, etc.
- Frontend closes SSE stream after receiving terminal state (`delivered` or `cancelled`)

---

## 7. Authorization & Security

### 7.1 ONDC Signing (Ed25519 + BLAKE2b-512)

All outbound requests are signed using the BAP's Ed25519 private key:

```typescript
// src/utils/crypto.ts
await createAuthorizationHeader({
  payload,                    // The full request body
  privateKeyBase64,           // Base64-encoded Ed25519 private key
  subscriberId,               // BAP's subscriber ID
  uniqueKeyId,                // UK ID for the signing key
});
```

The `Authorization` header format:
```
Authorization: Signature keyId="<subscriberId>|<uniqueKeyId>|ed25519", algorithm="ed25519", headers="digest", signature="<base64_signature>"
Digest: BLAKE2b-512(JSON.stringify(payload))
```

### 7.2 BPP Public Key Verification

All inbound BPP webhooks are verified against the BPP's public key from the ONDC Registry:

```typescript
// 1. Parse keyId from BPP's Authorization header
const keyId = "pramaan.ondc.org/beta/preprod/mock/seller|uk_id|ed25519"
const [subscriberId, ukId] = keyId.split("|")

// 2. Look up BPP's public key from ONDC Registry (cached 30 min)
const publicKey = await lookupBppPublicKey(authHeader)

// 3. Verify signature
await verifyAuthorizationHeader(authHeader, payload, publicKey)
```

**Env suffix mismatch handling:** BPPs sometimes register under `staging` but send webhooks under `preprod` (or vice versa). The registry lookup tries both variants.

### 7.3 JWT Authentication

The `/select` endpoint requires JWT authentication:
- Header: `Authorization: Bearer <token>`
- Token must have `user.id` claim
- If no token provided → proceeds unauthenticated (for testing)
- Returns 401 on invalid/expired token

---

## 8. Redis Usage

### 8.1 Session Management

```typescript
// src/utils/redis.ts

// Select session (pending — before /on_select)
setSelectPendingSession(txId, sessionData, { TTL: 2hours })
promoteSelectPendingSession(txId)  // After /on_select received

// After /on_select — promoted session with full data
setSelectSession(txId, sessionData, { TTL: 2hours })
getSelectSession(txId)

// Status cache (per-order, 30 min TTL)
setStatusCache(orderId, statusData)
getStatusCache(orderId)

// Track cache (per-order, 5 min TTL)
setTrackCache(orderId, trackData)
getTrackCache(orderId)
```

### 8.2 SSE Coordination

```typescript
// Client ownership (30s TTL, heartbeat refresh)
sse:client:{clientId} → instanceId

// Transaction binding (24h TTL)
sse:tx:{transactionId} → clientId

// Pub/Sub channel
sse:events  // Broadcasts events across all BFF instances
```

---

## 9. Cron Jobs

### 9.1 Catalog Refresh

```typescript
// src/services/cron.service.ts

// Full refresh — every 8 hours
// Fetches complete catalog from all BPPs

// Incremental refresh — every 30 minutes
// Only fetches BPPs that had catalog changes
// Skipped if full refresh ran within 5 minutes
```

### 9.2 /track Polling

```typescript
// src/utils/track-timers.ts

// Per-order polling cron
startTrackCron(orderId)    // Polls every 5 minutes
stopTrackCron(orderId)     // Stops on delivered/cancelled/NACK 40005
```

---

## 10. Error Handling

### 10.1 BPP NACK Codes

| Code | Meaning | Action |
|---|---|---|
| `20001` | Invalid catalog | Stop catalog refresh for this BPP |
| `30012` | Invalid cancellation reason | Remove from valid list |
| `30014` | Cannot cancel at this stage | Don't retry; notify buyer |
| `40005` | Tracking not available | Stop /track polling |
| `31003` | Order processing | Retry once after 5s |

### 10.2 Payment Error Codes

| Code | Meaning | Retryable |
|---|---|---|
| `JUSPAY_API_ERROR` | Juspay API error | Yes (transient) |
| `JUSPAY_NULL_RESPONSE` | Empty response | Yes |
| `HDFC_SESSION_EXPIRED` | Clock skew (HDFC side) | No |
| `MISSING_PAYMENT_URL` | No payment URL returned | Yes |
| `SESSION_CREATE_ERROR` | Internal error | Yes |

---

## 11. Key Business Rules Summary

### 11.1 Strict Idempotency Rules

| Action | Idempotency Key | Enforced Where | Notes |
|---|---|---|---|
| `pg_transaction` upsert | `transactionId` UNIQUE | `upsertPendingTransaction` raw SQL | One row per ONDC session |
| `/init` outbound | `transactionId` exists in `ondc_on_init` | `sendInitRequest` (MUST ADD) | Currently no guard — duplicate `/init` can be sent |
| `/init` inbound storage | `(bpp_id, transaction_id)` | `upsertOnInit` | |
| `/confirm` outbound | `confirmSentAt` column | `performConfirm` + `autoSendConfirm` | |
| `/confirm` inbound storage | `(bpp_id, transaction_id)` | `upsertOnConfirm` | Overwrites our outbound record |
| `/on_status` event row | `(bpp_id, transaction_id, message_id)` | `upsertOnStatus` | New row per BPP callback |
| HDFC callback | `transactionId` UNIQUE | `upsertPendingTransaction` | |

**CRITICAL:** If during `/select` a `transaction_id` already exists for this user+provider, you MUST check whether `/on_init` already exists for it. If `/on_init` exists, generate a NEW `transaction_id` — the user must complete or abandon the existing order first.

### 11.2 Transaction ID Lifecycle

```
/select called:
  ├── No prior session → generate new UUID (transaction_id)
  ├── Prior session exists, /on_init NOT received → REUSE transaction_id (clear stale Redis session)
  └── Prior session exists, /on_init ALREADY received → generate NEW transaction_id

Transaction_id is the single identifier for the complete ONDC/BPP order cycle.
It never changes from /select → /init → /confirm → /status → /track → /cancel.
```

### 11.3 Payment ID Mapping (CRITICAL — BUGS HERE)

**Three different IDs must never be confused:**

| ID | What it is | Where stored |
|---|---|---|
| ONDC `transaction_id` | UUID session key for the full BPP order cycle | `ondc_context.transactionId`, `pg_transaction.transactionId`, `sse:tx:{transactionId}` |
| HDFC `hdfcOrderId` | HDFC's own order ID (returned in session response as `payload.orderId`) | `pg_transaction.hdfcOrderId` — used to look up row from HDFC callback |
| HDFC `pgTxnId` | HDFC's transaction reference (returned in `juspay.order.status` as `content.order.txn_id`) | `pg_transaction.pgTxnId` — used as `payment.transaction_id` in `/confirm` |

**RULE: `pg_transaction.pgTxnId` MUST be the HDFC `txn_id` (e.g., `"SG2991-aa2aebb4d2e3515b-1"`). It is NOT the ONDC `transaction_id`.**

In `/confirm`, the payment block MUST use:
```typescript
payment: {
  transaction_id: pgTxnId,   // ← HDFC's txn_id, NOT ONDC transaction_id
  paid_amount: quote.price.value
}
```

### 11.4 SSE Binding Rules

**All SSE events route by `transactionId`, NOT `orderId`.**

```
Redis keys:
  sse:tx:{transactionId} → clientId  (TTL: 24h, set during /select and /init)
  sse:client:{clientId} → instanceId  (TTL: 30s, heartbeat refreshed)
  sse:user:tx:{userId} → transactionId  (TTL: 24h, for reconnect rebinding)
  init:user:{transactionId} → userId  (TTL: 24h, bridge for HDFC session creation)
```

**Reconnect flow:**
1. Frontend reconnects SSE with new `clientId`
2. `bindClientToActiveOrder(userId, newClientId)` called
3. `getUserActiveTransaction(userId)` → returns `transactionId`
4. `bindTransactionToClient(transactionId, newClientId)` → SSE events resume

**IMPORTANT:** `pushSSEvent` silently drops events if `sse:tx:{transactionId}` key is missing. After reconnect rebinding, the key is restored and events flow again.

### 11.5 Quote Echoing Rule (NON-NEGOTIABLE)

`/confirm` quote MUST be byte-for-byte identical to `/on_init` quote. This is enforced by ONDC compliance.

```typescript
// CORRECT — verbatim echo:
quote: {
  price: onInitOrder.quote.price,      // { currency: "INR", value: "350.00" }
  breakup: onInitOrder.quote.breakup,   // exact array from BPP
  ttl: onInitOrder.quote.ttl
}

// WRONG — any modification breaks ONDC compliance:
quote: {
  price: { currency: "INR", value: Number(quote.price.value) }  // DON'T
}
```

---

### 11.6 Business Rules Summary

1. **Quote immutability:** Quote from `/on_init` MUST be echoed verbatim in `/confirm`. Never modify prices.

2. **Payment gate:** `/confirm` is only sent when `pg_transaction.status === "CHARGED"`. The payment gate in `performConfirm` MUST remain enabled.

3. **Order ID format:** `odYYMMDD<random_hex_8chars>` (e.g., `od260410a3f9b2c1`). NOT the same as `transaction_id`.

4. **Transaction ID reuse:** Same `transaction_id` is reused across `/select` → `/init` → `/confirm` within one session. A new `transaction_id` is created for each new `/select` if `/on_init` was already received.

5. **HDFC `pgTxnId`:** The `payment.transaction_id` field in `/confirm` is the HDFC `pgTxnId` (from `statusResponse.content.order.txn_id`), NOT the ONDC `transaction_id`.

6. **Idempotency:** All outbound requests must have idempotency guards. Webhook handlers use `(bpp_id, transaction_id)` unique indexes.

7. **Audit logs:** Raw webhook payloads stored in MongoDB (never used for data retrieval).

8. **ACK-first:** All BPP webhooks are acknowledged immediately before async processing.

9. **Cancellation fees:**
   - `Pending` → 0% (food not prepared)
   - `Packed` or later → 100% (food prepared/in-delivery)

10. **Tracking polling stops on:**
    - BPP returns `inactive` status
    - NACK 40005 (tracking not available)
    - Terminal state (delivered/cancelled)

---

## 12. Known Bugs (Must Fix)

### Bug 1: `pgTxnId` stored as ONDC UUID instead of HDFC txn_id
**File:** `src/services/payment.service.ts` — `checkPaymentStatusFromHdfc` (line ~924)

```typescript
// CURRENT (BUG) — falls back to ONDC transaction_id:
pgTxnId: statusResponse?.content?.order?.txn_id ?? transactionId,

// SHOULD BE — HDFC txn_id only; if absent, don't update (undefined):
pgTxnId: statusResponse?.content?.order?.txn_id,
```

**Also:** `updateTransactionWithStatus` (line ~331) uses `if (pgTxnId) update.pgTxnId = pgTxnId` — this should unconditionally set to `pgTxnId ?? null`.

**Impact:** `/confirm` `payment.transaction_id` gets the ONDC UUID instead of HDFC's `pgTxnId`. ONDC contract violation.

### Bug 2: Payment gate commented out in `performConfirm`
**File:** `src/controllers/confirm.controller.ts` — lines 130-140

The check `pgRow.status !== "CHARGED"` is commented out with a TODO. Without it, `/confirm` can be sent even when payment failed.

**Fix:** Uncomment the payment gate block.

### Bug 3: No idempotency guard in `sendInitRequest`
**File:** `src/services/init.service.ts`

If frontend calls `/init` twice with the same `transaction_id`, two outbound `/init` requests are sent to the BPP. `processOnInit` is idempotent (upserts on BPP callback), but the outbound request is not.

**Fix:** Add check at top of `sendInitRequest`:
```typescript
const existingInit = await findOnInitByTransactionId(transaction_id);
if (existingInit) {
  return { transaction_id, message_id: existingInit.messageId };
}
```

### Bug 4: `processOnTrack` uses BPP `context.transaction_id` instead of resolved `transactionId`
**File:** `src/services/track.service.ts` — line 293

```typescript
// CURRENT (uses BPP's potentially wrong context.transaction_id):
await pushSSEvent("on_status", { order_id: orderId, ... }, context?.transaction_id);

// SHOULD BE (use resolved transactionId from orderId lookup):
await pushSSEvent("on_status", { order_id: orderId, ... }, transactionId);
```

### Bug 5: `pushSSEvent` silently drops events when no clientId bound
**File:** `src/utils/sse-manager.ts` — lines 231-243

When `clientId` lookup fails, the event is returned with only a `logger.warn` — no broadcast. Events are silently lost if frontend disconnects and reconnects with a new `clientId` before rebinding completes.

**Fix:** Instead of early return, fall back to Pub/Sub broadcast so any connected client can receive the event.

---

## 13. Item Schema — FK Chain Reference

The complete FK chain for a catalog item (`ondc_items`):

```
ondc_items.id = 1
  ├── provider_id = 1          → ondc_providers.id
  ├── descriptor_id = 1        → item_descriptor.id
  │                                name, short_desc, long_desc, image_url[]
  ├── price_id = 1             → item_price.id
  │                                currency, value, maximum_value
  ├── quantity_id = 1          → item_quantity.id
  │                                available_count, maximum_count
  │                                └── unitized_id = 1 → item_quantity_unitized.id
  │                                      unit, value
  ├── time_id = 1              → item_time.id
  │                                label (enable/disable)
  ├── ondc_fields_id = 1       → item_ondc_fields.id
  │                                returnable, cancellable, time_to_ship, etc.
  │                                └── ondc_fields_id = 1 → item_statutory_reqs.id
  │                                      manufacturer, net_quantity, etc.
  ├── fulfillment_id = "F1"
  ├── location_id = "L1"
  ├── category_id = "F&B"      ← ALWAYS "F&B" for RET11 (hardcoded invariant)
  ├── category_ids = "5:1,6:2" ← colon-separated "categoryId:rank" for custom_menu
  └── tag_id = 1               → item_tag.id
                                   code (veg_nonveg/timing/config/etc.)
                                   └── item_tag_list_item → (code, value pairs)
```

---

## 13. API Endpoints Summary

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/search` | Search catalog (broadcasts to all BPPs) |
| POST | `/api/v1/select` | Select items (creates order session) |
| GET | `/api/v1/select/result/:transaction_id` | Get select result |
| POST | `/api/v1/init` | Initialize order |
| POST | `/api/v1/confirm` | Confirm order (after payment) |
| GET | `/api/v1/confirm/status/:transaction_id` | Get confirm status |
| POST | `/api/v1/status` | Poll fulfillment status |
| GET | `/api/v1/status/:order_id` | Get status for order |
| POST | `/api/v1/track` | Request live tracking |
| POST | `/api/v1/cancel` | Cancel order |
| POST | `/api/v1/on_cancel` | BPP cancellation webhook |
| GET | `/api/v1/stream/:clientId` | SSE event stream |
| POST | `/api/v1/payment/callback` | HDFC payment callback |
| POST | `/api/v1/on_search` | BPP catalog webhook |
| POST | `/api/v1/on_select` | BPP selection webhook |
| POST | `/api/v1/on_init` | BPP init webhook |
| POST | `/api/v1/on_confirm` | BPP confirm webhook |
| POST | `/api/v1/on_status` | BPP status webhook |
| POST | `/api/v1/on_track` | BPP tracking webhook |
| POST | `/api/v1/onboarding/subscribe` | ONDC registry subscription |
| GET | `/api/v1/registry/lookup` | BPP public key lookup |
| GET | `/api/v1/catalog` | Frontend catalog API |

---

## 14. When Working on This Codebase

**Always load this skill when:**
- Working on any ONDC-related code
- Implementing new flows or modifying existing ones
- Handling webhooks (`/on_search`, `/on_select`, etc.)
- Working with schemas, repositories, or services
- Debugging ONDC integrations
- Working with payment (HDFC/Juspay)
- Working with SSE events
- Working with Redis session management
- Modifying database schemas
- Understanding cancellation, tracking, or status flows

**Key files to reference:**
- `src/db/schema/enums.ts` — All enum values
- `src/services/confirm.service.ts` — Core confirm flow with quote handling
- `src/services/payment.service.ts` — HDFC/Juspay integration (CRITICAL: pgTxnId must be HDFC txn_id, NOT ONDC transaction_id — see bugs)
- `src/services/cancel.service.ts` — Cancellation rules and VALID_CANCEL_REASON_IDS
- `src/utils/sse-manager.ts` — SSE architecture (CRITICAL: pushSSEvent silently drops if no clientId bound)
- `src/utils/crypto.ts` — Ed25519 signing
- `src/services/registry.service.ts` — BPP key lookup with env suffix handling
- `src/db/schema/item.schema.ts` — Item FK chain diagram
- `src/db/schema/pg-transaction.schema.ts` — Payment lifecycle
- `src/controllers/confirm.controller.ts` — confirm endpoint (payment gate must remain enabled)
- `src/controllers/select.controller.ts` — transaction_id reuse rules (must check /on_init before reuse)
- `src/services/init.service.ts` — init service (BUG: no idempotency guard for double-/init)
- `src/services/status.service.ts` — on_status processing (SSE routing by transactionId only)
- `src/services/track.service.ts` — track service (BUG: pushSSEvent uses BPP context.transaction_id instead of resolved transactionId)
