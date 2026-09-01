# ONDC F&B (ONDC:RET11) — Buyer NP Reference

This file captures the authoritative F&B-specific and Buyer NP-specific contract rules from
the ONDC API Contract for Retail v1.2.0. Read this alongside `ondc-core-knowledge.md`.

---

## F&B Domain Identity

- **Domain code**: `ONDC:RET11`
- **Category**: Food & Beverages
- **FSSAI license** (`@ondc/org/fssai_license_no`) is mandatory on every provider in F&B catalogs
- Search scope: F&B can only be searched **by city** — sub-category search is not supported because F&B category hierarchy is inconsistent across merchants

---

## Buyer NP Architecture

The Buyer NP (BAP) exposes two surfaces:

| Surface                         | Purpose                                           |
| ------------------------------- | ------------------------------------------------- |
| **Outbound API**                | Sends requests to BPP (via Gateway for `/search`) |
| **Webhook (callback receiver)** | Receives `on_*` async callbacks from BPP          |

The BAP never waits for a callback inline. Every request-response pair is async:

1. BAP sends request → BPP sends ACK (or NACK) synchronously
2. BPP sends `on_*` callback → BAP sends ACK (or NACK) synchronously

Sign all outbound requests. Verify all incoming callbacks before processing.

---

## Transaction ID Strategy for F&B

F&B apps typically **cache catalogs** across multiple buyers. The contract says:

- For **live search** apps: same `transaction_id` across search, select, init, confirm
- For **catalog-cached** apps: use a **new unique `transaction_id`** starting from `/select`

Meaning: if your BAP fetches catalog once and serves it to many users, each buyer's cart starts fresh at `/select` with a new `transaction_id`. The `transaction_id` for `/select`, `/init`, and `/confirm` must be the same for one order.

---

## BAP Terms — Required in Every Search

The `/search` request must always include `bap_terms` in `message.intent.tags`:

```json
{
  "code": "bap_terms",
  "list": [
    { "code": "static_terms", "value": "" },
    {
      "code": "static_terms_new",
      "value": "https://github.com/ONDC-Official/NP-Static-Terms/buyerNP_BNP/1.0/tc.pdf"
    },
    { "code": "effective_date", "value": "2023-10-01T00:00:00.000Z" }
  ]
}
```

Also include the **buyer finder fee** — how much the BAP charges the seller NP for bringing the buyer:

```json
{
  "code": "payment",
  "value": {
    "@ondc/org/buyer_app_finder_fee_type": "percent",
    "@ondc/org/buyer_app_finder_fee_amount": "3"
  }
}
```

For F&B, the search payload uses only `domain: "ONDC:RET11"` and city — no `category.id`.

---

## F&B Catalog Structure (What Seller NP Sends in /on_search)

Understanding the catalog structure is critical for ingestion. F&B catalogs have a unique
make-to-order model using **customization groups** and **customizations**.

### Catalog layers

```
catalog
├── bpp/descriptor      — Seller NP's platform info, bpp_terms (np_type, collect_payment)
├── bpp/fulfillments    — Fulfillment types offered (Delivery, Self-Pickup, Buyer-Delivery)
└── bpp/providers[]     — One per restaurant/store
    ├── id, descriptor, @ondc/org/fssai_license_no
    ├── time.label ("enable"/"disable"), time.timestamp (catalog version)
    ├── ttl (e.g. "P1D" — how long to cache this provider)
    ├── locations[]     — Store locations with GPS, area_code, timings
    ├── fulfillments[]  — Provider-level fulfillment types
    ├── categories[]    — F&B base categories and customization group definitions
    └── items[]         — Base SKU items AND customization items
```

### Item types in F&B catalog

Items array contains three distinct types, differentiated by tags:

| Tag `type.type`                  | Meaning                                                     |
| -------------------------------- | ----------------------------------------------------------- |
| `item`                           | A base SKU (e.g. "Farmhouse Pizza") — what the buyer orders |
| `customization`                  | An individual option (e.g. "Large", "Wheat Crust")          |
| `customization_group` (category) | Group of options (e.g. "Size", "Crust")                     |

### Customization Group rules (critical for catalog ingestion)

Categories define customization group configs:

```json
{
  "id": "CG1",
  "descriptor": { "name": "Crust" },
  "tags": [
    {
      "code": "config",
      "list": [
        { "code": "min", "value": "1" }, // min=1 means mandatory
        { "code": "max", "value": "1" },
        { "code": "input", "value": "select" },
        { "code": "seq", "value": "1" }
      ]
    }
  ]
}
```

**Mandatory CG rule**: If a CG has `min > 0` and either:

- Its definition is missing/invalid, OR
- No customizations are mapped to it
  → The BAP **must disable the base item** entirely. Do not show it to the buyer.

Item-level CG config overrides category-level config if provided.

### Catalog versioning

- `provider.time.timestamp` — when this provider's snapshot was generated (full refresh)
- `provider.ttl` — how long to cache (e.g. `"P1D"`)
- Item/location `time.timestamp` — used in incremental refresh to indicate event time

---

## Catalog Refresh Flow

### Full refresh

1. BAP sends `/search` with city (no `catalog_inc` tag → defaults to full refresh)
2. BPP sends `/on_search` with complete catalog per provider
3. BAP overwrites cached items for that provider with the received list
4. Items missing from the refresh are **disabled** (not deleted, since BPP sends per-provider pages)
5. Providers can only be explicitly disabled via incremental refresh

### Incremental refresh (push mode)

BAP subscribes by sending `/search` with `catalog_inc` tag:

```json
{ "code": "catalog_inc", "list": [{ "code": "mode", "value": "start" }] }
```

- BPP pushes deltas every 1–30 minutes (its discretion)
- BAP can have **only 1 open incremental request** at a time — stop before starting a new one
- Stop using `mode: "stop"` with the **same `transaction_id`** as the start request

### Race condition handling

If full refresh and incremental arrive simultaneously:

- Option A: Process full refresh, then restart incremental from its timestamp
- Option B: Process both in sequence, use timestamps to decide which updates to persist

---

## /search — BAP Sends

```json
{
  "context": {
    "domain": "ONDC:RET11",
    "action": "search",
    "country": "IND",
    "city": "std:080",
    "core_version": "1.2.0",
    "bap_id": "buyerNP.com",
    "bap_uri": "https://buyerNP.com/ondc",
    "transaction_id": "T1",
    "message_id": "M1",
    "timestamp": "2023-06-03T08:00:00.000Z",
    "ttl": "PT30S"
  },
  "message": {
    "intent": {
      "fulfillment": {
        "type": "Delivery",
        "end": { "location": { "gps": "12.974002,77.613458", "address": { "area_code": "560001" } } }
      },
      "payment": {
        "@ondc/org/buyer_app_finder_fee_type": "percent",
        "@ondc/org/buyer_app_finder_fee_amount": "3"
      },
      "tags": [{ "code": "bap_terms", "list": [ ... ] }]
    }
  }
}
```

- No `category.id` for F&B (unlike Grocery which can filter by sub-category)
- Include delivery end location for serviceability-aware catalog filtering
- `city: "*"` means all cities (useful for incremental refresh)

---

## /select — BAP Sends (F&B Make-to-Order)

In F&B, the buyer builds a customized product. The BAP sends a **dynamic item ID** that groups the base item + selected customizations:

```json
{
  "message": {
    "order": {
      "provider": { "id": "P1", "locations": [{ "id": "L1" }] },
      "items": [
        {
          "id": "I1",
          "parent_item_id": "DI1", // dynamic item ID — groups this cart line
          "location_id": "L1",
          "quantity": { "count": 1 },
          "tags": [
            { "code": "type", "list": [{ "code": "type", "value": "item" }] }
          ]
        },
        {
          "id": "C1", // customization item (e.g. "New Hand Tossed" crust)
          "parent_item_id": "DI1", // same dynamic item ID as the base item
          "location_id": "L1",
          "quantity": { "count": 1 },
          "tags": [
            {
              "code": "type",
              "list": [{ "code": "type", "value": "customization" }]
            },
            { "code": "parent", "list": [{ "code": "id", "value": "CG1" }] } // which CG this belongs to
          ]
        }
        // ... more customizations for same DI1, or another DI2 for a second pizza
      ]
    }
  }
}
```

Key rules:

- Each customized product instance gets its own `parent_item_id` (dynamic item ID)
- Each base item has tag `type: "item"`, each customization has tag `type: "customization"` + `parent: CG_ID`
- Multiple items in cart = multiple groups of `parent_item_id`

---

## /on_select — What Seller NP Returns (BAP Must Handle)

BPP checks serviceability and inventory, then returns a quote.

**What BAP must do:**

1. Check if fulfillment state is `"Serviceable"` — if not, show appropriate error to buyer
2. Check if items are in stock (from `quote.breakup[].item.quantity.available`)
3. If `error.code == 30023` → minimum order value not met — prompt buyer to add more items
4. Check if quote TTL is still valid before proceeding to `/init`
5. Note: if BPP returns a different `provider.locations[].id` than what was sent, use that location in `/init`
6. Quote is **not frozen** until `/on_init` — changes in address or cart require calling `/select` again

Quote structure:

```
quote.price.value = sum of all quote.breakup[].price.value
title_type "item"     → item price (has both unit + total)
title_type "delivery" → delivery charges
title_type "tax"      → tax
title_type "discount" → discounts
title_type "misc"     → miscellaneous (packaging, etc.)
```

---

## /init — BAP Sends

Provides buyer billing and delivery address. Fulfillment ID may change if buyer switched fulfillment type.

```json
{
  "message": {
    "order": {
      "provider": { "id": "P1", "locations": [{ "id": "L1" }] },
      "items": [ /* same as /select, with fulfillment_id added */ ],
      "billing": {
        "name": "Buyer Name",
        "address": { "name": "...", "building": "...", "locality": "...", "city": "Bengaluru", "state": "Karnataka", "country": "IND", "area_code": "560001" },
        "email": "buyer@example.com",
        "phone": "9886098860",
        "created_at": "...", "updated_at": "..."
      },
      "fulfillments": [
        {
          "id": "F1",
          "type": "Delivery",
          "end": {
            "location": { "gps": "...", "address": { ... } },
            "contact": { "phone": "...", "email": "..." }
          }
        }
      ],
      "payment": {
        "@ondc/org/buyer_app_finder_fee_type": "percent",
        "@ondc/org/buyer_app_finder_fee_amount": "3",
        "type": "ON-FULFILLMENT"   // or "ON-ORDER" for prepaid
      }
    }
  }
}
```

---

## /on_init — What Seller NP Returns (BAP Must Handle)

BPP confirms payment terms and cancellation terms. Quote is frozen here.

**Key fields BAP must process:**

1. **Payment link** (if BPP collects payment, i.e. `collect_payment: "Y"`):
   - `payment.type = "ON-ORDER"`, `payment.collected_by = "BPP"`
   - `payment.uri` = secure payment link → BAP must render this to the buyer
   - `payment.status = "NOT-PAID"` initially
   - Then BPP sends unsolicited `/on_init` with payment status update:
     - `status="PAID"` + `tags.bpp_collect.success="Y"` → proceed to `/confirm`
     - `status="NOT-PAID"` + `success="Y"` → BAP may proceed (BPP will update later)
     - `status="NOT-PAID"` + `success="N"` → **terminate transaction**
   - If BAP doesn't receive update within TAT → terminate transaction; NACK any late `/on_init` with error `20009`

2. **Cancellation terms**: BPP defines fee per fulfillment state + reason code. BAP must store these to calculate cancellation fees later.

3. Quote changes: if BPP changes the quote from `/on_select`, BAP must inform the buyer before proceeding.

---

## /confirm — BAP Sends

Places the order. Includes `order.id` and `order.state: "Created"`.

```json
{
  "message": {
    "order": {
      "id": "O1",
      "state": "Created",
      "provider": { ... },
      "items": [ /* same as /init */ ],
      "billing": { ... },
      "fulfillments": [ ... ],
      "payment": {
        "type": "ON-ORDER",
        "paid_amount": "894.00",
        "status": "PAID",
        "transaction_id": "txn-ref-from-pg",
        "collected_by": "BAP",
        "@ondc/org/buyer_app_finder_fee_type": "percent",
        "@ondc/org/buyer_app_finder_fee_amount": "3"
      }
    }
  }
}
```

---

## /on_confirm — What Seller NP Returns

BPP sets `order.state` to:

- `"Accepted"` — order placed, auto-accepted
- `"Created"` — order placed, deferred acceptance (BNP must poll `/status`)
- Error with rejection — BAP must inform buyer

**Fulfillment states in F&B order lifecycle:**

```
Pending → Packed → Order-picked-up → Out-for-delivery → Order-delivered
```

Each state is in `fulfillments[].state.descriptor.code`.

---

## /status — BAP Sends (Polling)

Simple poll:

```json
{ "message": { "order_id": "O1" } }
```

BPP returns the current order + all fulfillment states.

**When to poll**: after `/on_confirm`, periodically to show tracking to buyer. Also poll after TAT breach to verify before force cancel.

---

## /cancel — BAP Sends

```json
{
  "message": {
    "order_id": "O1",
    "cancellation_reason_id": "001",
    "descriptor": {
      "short_desc": "F1", // fulfillment ID being cancelled (if partial)
      "tags": [
        {
          "code": "params",
          "list": [
            { "code": "force", "value": "no" },
            { "code": "ttl_response", "value": "PT1H" }
          ]
        }
      ]
    }
  }
}
```

**Cancellation reason codes (Buyer NP)**:

| Code | Reason                                                         |
| ---- | -------------------------------------------------------------- |
| 001  | Price of one or more items have changed                        |
| 002  | One or more items in the Order not available                   |
| 003  | Product available at lower price                               |
| 004  | Order in pending shipment/delivery state                       |
| 005  | Merchant not accepting orders                                  |
| 006  | Fulfillment not available for customer's location (TAT breach) |

**Force cancellation flow**: If BPP doesn't send valid `/on_cancel` within the `ttl_response`:

1. BAP sends `/cancel` again with `force: "yes"`
2. If still no response → raise IGM issue for resolution
3. IGM resolution creates a valid `/on_cancel` for the force cancel

**Cancellation fee calculation**:

- From `/on_cancel` response: `order_value_at_confirm - updated_order_value_in_on_cancel`
- If no response: use cancellation terms from `/on_init` for matching fulfillment state + reason code

**Unsolicited cancellation** (BPP initiates via `/on_cancel`):

- BPP sets all order + fulfillment states to `"Cancelled"`
- BAP may NACK with `22502` if `cancellation_reason_id` is invalid for seller-initiated cancel

---

## /on_cancel — What Seller NP Returns

BPP returns the updated order with `state: "Cancelled"` and updated quote reflecting any cancellation fees.

---

## /track — BAP Sends (Optional for F&B)

```json
{ "message": { "order_id": "O1", "callback_url": "wss://..." } }
```

BPP returns tracking URL or GPS coordinates. F&B tracking is typically live for delivery.

---

## Order & Fulfillment States Reference

**Order states**: `Created` → `Accepted` → `Completed` / `Cancelled`

**Fulfillment states** (forward):

```
Pending → Packed → Order-picked-up → Out-for-delivery → Order-delivered
```

**Fulfillment states** (cancellation/RTO):

```
Cancelled
RTO-Initiated → RTO-Delivered / RTO-Disposed
```

**Rules**:

- Item-level cancel only allowed when fulfillment state is `"Pending"`
- Return only allowed when fulfillment state is `"Order-delivered"`

---

## Payment Flows

### BAP Collects Payment (This Project — Always Mandatory)

**This project ALWAYS requires BAP to collect payment.** The BAP declares `collected_by: "BAP"` in its `/init`
request, making BAP-collected prepaid (`ON-ORDER`) the sole supported payment model — regardless of what
the BPP's `bpp_terms.collect_payment` flag indicates in its catalog.

```
payment.collected_by = "BAP"
payment.type = "ON-ORDER"
```

BAP handles the payment gateway end-to-end and passes `transaction_id` (PG reference) in `/confirm`.

### BPP Collects Payment (Not Supported in This Project)

If a BPP sends `bpp_terms.collect_payment = "Y"` in its catalog, the BPP is indicating it wants to collect
payment. However, this project does **not** support BPP payment collection. The BAP always overrides with
`collected_by: "BAP"` in `/init`.

If `/on_init` echoes back `collected_by: "BPP"`:

- Log and alert engineering (this indicates a catalog or BPP misconfiguration)
- Treat as an error condition — do not proceed with payment collection through BPP's URI

```
bpp_terms.collect_payment = "Y"  (BPP's catalog declaration — ignored by this BAP)
payment.collected_by = "BAP"      (BAP's mandatory override in /init)
payment.type = "ON-ORDER"
```

---

## Key Error Codes for BAP

| Code    | Meaning                                            | Sent by                             |
| ------- | -------------------------------------------------- | ----------------------------------- |
| `30001` | Item not found                                     | BPP                                 |
| `30004` | Item quantity unavailable                          | BPP                                 |
| `30009` | No items available                                 | BPP                                 |
| `30012` | Invalid cancellation reason ID                     | BPP                                 |
| `30014` | Fulfillment TAT not breached                       | BPP                                 |
| `30023` | Cart below minimum order value                     | BPP                                 |
| `22502` | Invalid seller cancellation reason                 | BAP (NACK to unsolicited on_cancel) |
| `20002` | Stale request (timestamp earlier than processed)   | Both                                |
| `20009` | Late payment status update (after BAP TAT expired) | BAP (NACK to late on_init)          |

---

## Seller NP Behavior — What BAP Should Expect

Understanding what the BPP is supposed to do helps you build correct BAP handling:

- **ACK first, callback later**: BPP always sends ACK/NACK synchronously, then the real data async via callback
- **Catalog pagination**: BPP may send multiple `/on_search` callbacks, one per provider — BAP must handle receiving them in any order
- **Incremental deltas**: BPP should push deltas within 1–30 minutes of a catalog change
- **Serviceability check in /on_select**: BPP checks if delivery location is serviceable and if items are in stock
- **Quote not frozen at /on_select**: BPP may adjust quote in `/on_init` if address or cart changes
- **Deferred acceptance**: BPP may accept in `on_confirm` with state `"Created"` (not `"Accepted"`) — BAP must poll `/status`
- **Unsolicited callbacks**: BPP can send unsolicited `/on_cancel` (seller cancels) and `/on_status` (proactive state updates). BAP must handle these
- **bpp_terms in catalog**: `np_type` ("ISN" = single seller, "MSN" = marketplace), `accept_bap_terms` ("Y"/"N"), `collect_payment` ("Y"/"N")
- **FSSAI required**: Every F&B provider must have `@ondc/org/fssai_license_no` — treat providers without it as incomplete

---

## Common BAP Implementation Mistakes

- **Not validating mandatory CGs**: If a base item's mandatory CG is missing or invalid, the item must be disabled — showing it leads to broken `/select` flows
- **Using old quote after address change**: If buyer changes delivery address, call `/select` again — the quote may change
- **Not handling unsolicited callbacks**: BPP can push `/on_cancel` and `/on_status` without BAP requesting them — BAP webhook must accept these
- **Sending `category.id` in F&B search**: Only Grocery (RET10) supports sub-category search; F&B ignores/rejects it
- **Same `transaction_id` across different orders**: For catalog-cached apps, each buyer's order needs its own `transaction_id` from `/select` onward
- **Ignoring `collect_payment` flag**: If BPP wants to collect payment, BAP must render the payment link — otherwise the flow breaks
- **Not stopping incremental before starting a new one**: Only 1 open incremental per BAP; send `mode:"stop"` with the original `transaction_id` before starting a new subscription
