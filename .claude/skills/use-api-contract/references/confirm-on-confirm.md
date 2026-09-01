# /confirm + /on_confirm Deep Reference — ONDC F&B (ONDC:RET11)

> **Scope**: This reference is specific to this project's constraints:
>
> - **Fulfillment type**: `Delivery` only
> - **Payment**: BAP-collected prepaid (`type: "ON-ORDER"`, `collected_by: "BAP"`) only
> - **Order state at /confirm**: `"Created"` (BAP sets); BPP transitions to `"Accepted"` or deferred
> - No COD, no BPP payment collection, no Self-Pickup, no Buyer-Delivery
>
> **When to read this file**: Implementing or debugging `/confirm` (sending payment proof to BPP)
> or `/on_confirm` (receiving BPP acknowledgment). Also covers order state machine, unsolicited
> `on_status` callbacks, and BPP-initiated cancellation handling.

---

## Table of Contents

1. [Overview — Confirm Flow](#1-overview--confirm-flow)
2. [When to Send /confirm](#2-when-to-send-confirm)
3. [/confirm Request — Payload Schema](#3-confirm-request--payload-schema)
4. [/confirm Scenarios](#4-confirm-scenarios)
   - 4.1 Standard — BAP Prepaid, Delivery
   - 4.2 With Fulfillment Time slot
   - 4.3 With Offer Applied
5. [/on_confirm Response — Payload Schema](#5-on_confirm-response--payload-schema)
6. [/on_confirm Scenarios](#6-on_confirm-scenarios)
   - 6.1 Order Accepted Immediately
   - 6.2 Order Accepted with TAT Deferral
   - 6.3 BPP Returns Error in /on_confirm
7. [Order State Machine](#7-order-state-machine)
8. [Unsolicited on_status — BPP-Initiated Updates](#8-unsolicited-on_status--bpp-initiated-updates)
9. [Enum Reference Tables](#9-enum-reference-tables)
10. [Idempotency and Order Identity](#10-idempotency-and-order-identity)
11. [SNP/BPP Validation of /confirm — BPP Side Rules](#11-snpbpp-validation-of-confirm--bpp-side-rules)
12. [BNP/BAP Validation of /on_confirm — BAP Side Rules](#12-bnpbap-validation-of-on_confirm--bap-side-rules)
13. [Retry + Cancel Decision Tree (Full View)](#13-retry--cancel-decision-tree-full-view)
14. [Error Codes](#14-error-codes)
15. [BAP Processing Algorithm for /on_confirm](#15-bap-processing-algorithm-for-on_confirm)
16. [Complete Example — Full /confirm Request](#16-complete-example--full-confirm-request)

---

## 1. Overview — Confirm Flow

```
BAP → PG  :          (charge buyer — HDFC SmartGateway in this project)
BAP → BPP : /confirm  (order.id + order.state:"Created" + payment proof)
BPP → BAP : /on_confirm (order.state:"Accepted" or deferred — async)
BPP → BAP : /on_status  (unsolicited state updates as fulfillment progresses)
BPP → BAP : /on_cancel  (BPP-initiated cancellation — unsolicited)
```

**Position in order lifecycle**: `/confirm` is the final commitment step. Payment has already been
collected by BAP before `/confirm` is sent. The BPP acknowledges the order and begins fulfillment.

**Critical invariants for BAP-collected prepaid**:

| Invariant                | Rule                                                                          |
| ------------------------ | ----------------------------------------------------------------------------- |
| `order.id`               | BAP generates a new unique order ID (UUID) — NOT the same as `transaction_id` |
| `order.state`            | Always `"Created"` in `/confirm` — BPP transitions to `"Accepted"`            |
| `payment.status`         | Always `"PAID"` — payment already collected by BAP's PG                       |
| `payment.transaction_id` | PG's own reference ID (e.g. HDFC txn ref) — NOT ONDC `transaction_id`         |
| `payment.collected_by`   | Always `"BAP"`                                                                |
| `payment.paid_amount`    | Must exactly equal `on_init.quote.price.value`                                |
| `quote`                  | Echoed verbatim from `/on_init` — do NOT modify after /init                   |
| `fulfillments`           | Echoed from `/on_init` (or `/init` if BPP didn't change)                      |

---

## 2. When to Send /confirm

### Prerequisites (all must be true)

- `payment_status` SSE event received with `status === "CHARGED"` (HDFC payment confirmed)
- `pg_txn_id` available from the `payment_status` event
- Valid `/on_init` response received and validated (quote frozen, cancellation terms stored)
- Order not already confirmed (idempotency guard: do not re-send if already confirmed for this `transaction_id`)

### NEVER call /confirm when:

- Payment still `PENDING` or `PENDING_VBV` (3D auth in progress)
- Payment failed (`AUTHENTICATION_FAILED`, `AUTHORIZATION_FAILED`, `CANCELLED`, `EXPIRED`)
- No valid `/on_init` received yet
- Quote changed from `/on_init` and buyer has not re-confirmed
- Already received a valid `/on_confirm` for this `transaction_id` (idempotent — return success)

### What to do if payment failed

```
PG status === FAILED:
→ do NOT call /confirm
→ show failure screen to buyer
→ offer retry via POST /payment/retry/:transactionId
→ if buyer abandons: mark session failed; allow restart from cart
```

---

## 3. /confirm Request — Payload Schema

```
context (required)
  domain            "ONDC:RET11"
  action            "confirm"
  core_version      "1.2.0"
  bap_id            string — BAP subscriber ID
  bap_uri           string — BAP callback URL
  bpp_id            string — BPP subscriber ID (from /on_init context)
  bpp_uri           string — BPP endpoint URL (from /on_init context)
  transaction_id    string — SAME as /select, /init, /on_init for this order session
  message_id        string — unique per API call (new UUID)
  city              string — "std:080" format (same as previous steps)
  country           "IND"
  timestamp         ISO8601 UTC
  ttl               "PT30S"

message.order (required)

  id                string — BAP-generated unique order ID (UUID). FIRST appearance of order.id.
                         NOT the same as transaction_id. Generated fresh when buyer confirms.
                         Reused on retry (idempotent).
  state             "Created" — always "Created" in /confirm. BPP transitions to "Accepted".

  provider
    id              string — same provider ID from /on_init
    locations[]
      id            string — same location ID from /on_init

  items[]           — mirrored from /on_init items (unchanged from /init)
    id              string
    parent_item_id  string? — same as /init (for F&B customized items)
    fulfillment_id  string  — same fulfillment_id from /init
    location_id     string  — same location_id from /init
    quantity
      count         integer — same count as /init

  billing           — echoed from /init (unchanged)
    name            string
    address
      name          string?
      building      string?
      locality      string
      city          string
      state         string
      country       "IND"
      area_code     string
    email           string
    phone           string
    created_at      ISO8601 UTC
    updated_at      ISO8601 UTC

  fulfillments[]    — echoed from /init (with BPP-confirmed values from /on_init)
    id              string — fulfillment ID (e.g. "F1")
    type            "Delivery"
    @ondc/org/provider_name  string? — LSP name from /on_init (if present)
    tracking        boolean? — from /on_init
    @ondc/org/category       string? — "Immediate Delivery" from /on_init
    @ondc/org/TAT   string? — delivery TAT from /on_init
    state
      descriptor
        code        "Pending" — initial state at confirm time
    end
      location
        gps          string
        address
          name       string?
          building   string?
          locality   string
          city       string
          state      string
          country    "IND"
          area_code  string
      contact
        phone        string
        email        string?
      time
        range
          start      ISO8601 UTC? — confirmed slot from /on_init (if slotted)
          end        ISO8601 UTC? — confirmed slot from /on_init (if slotted)

  quote             — echoed verbatim from /on_init (do NOT recalculate or modify)
    price
      currency      "INR"
      value         string — MUST equal on_init.quote.price.value
    breakup[]
      — same as /on_init.quote.breakup (verbatim)
    ttl             string? — from /on_init

  payment (required — BAP-collected prepaid proof)
    @ondc/org/buyer_app_finder_fee_type    "percent"
    @ondc/org/buyer_app_finder_fee_amount  "3"
    type            "ON-ORDER"
    collected_by    "BAP"
    status          "PAID"          — payment already collected by BAP's PG
    transaction_id  string          — PG's own reference ID (e.g. HDFC txn ref)
                                       NOT the ONDC transaction_id
    paid_amount     string          — MUST equal on_init.quote.price.value
```

---

## 4. /confirm Scenarios

### 4.1 Standard — BAP Prepaid, Delivery

Most common F&B order: single item, prepaid via HDFC, delivery to buyer address.

```json
{
  "context": {
    "domain": "ONDC:RET11",
    "action": "confirm",
    "core_version": "1.2.0",
    "bap_id": "buyerNP.com",
    "bap_uri": "https://buyerNP.com/ondc",
    "bpp_id": "sellerNP.com",
    "bpp_uri": "https://sellerNP.com/ondc",
    "transaction_id": "T2",
    "message_id": "M4",
    "city": "std:080",
    "country": "IND",
    "timestamp": "2023-06-03T08:45:00.000Z",
    "ttl": "PT30S"
  },
  "message": {
    "order": {
      "id": "O1-uuid-generated-by-BAP",
      "state": "Created",
      "provider": { "id": "P1", "locations": [{ "id": "L1" }] },
      "items": [
        {
          "id": "I1",
          "fulfillment_id": "F1",
          "location_id": "L1",
          "quantity": { "count": 1 }
        }
      ],
      "billing": {
        "name": "Buyer Name",
        "address": {
          "name": "My Apartment",
          "building": "Tower A",
          "locality": "Koramangala",
          "city": "Bengaluru",
          "state": "Karnataka",
          "country": "IND",
          "area_code": "560034"
        },
        "email": "buyer@example.com",
        "phone": "9886098860",
        "created_at": "2023-06-03T08:30:00.000Z",
        "updated_at": "2023-06-03T08:30:00.000Z"
      },
      "fulfillments": [
        {
          "id": "F1",
          "type": "Delivery",
          "@ondc/org/provider_name": "LSP Name",
          "tracking": false,
          "@ondc/org/category": "Immediate Delivery",
          "@ondc/org/TAT": "PT60M",
          "state": { "descriptor": { "code": "Pending" } },
          "end": {
            "location": {
              "gps": "12.453544,77.928379",
              "address": {
                "name": "My Apartment",
                "building": "Tower A",
                "locality": "Koramangala",
                "city": "Bengaluru",
                "state": "Karnataka",
                "country": "IND",
                "area_code": "560034"
              }
            },
            "contact": { "phone": "9886098860", "email": "buyer@example.com" }
          }
        }
      ],
      "quote": {
        "price": { "currency": "INR", "value": "264.00" },
        "breakup": [
          {
            "@ondc/org/item_id": "I1",
            "@ondc/org/item_quantity": { "count": 1 },
            "title": "Farm House Pizza",
            "@ondc/org/title_type": "item",
            "price": { "currency": "INR", "value": "170.00" },
            "item": {
              "quantity": {
                "available": { "count": "99" },
                "maximum": { "count": "99" }
              },
              "price": { "currency": "INR", "value": "170.00" }
            }
          },
          {
            "@ondc/org/item_id": "F1",
            "title": "Delivery charges",
            "@ondc/org/title_type": "delivery",
            "price": { "currency": "INR", "value": "50.00" }
          },
          {
            "@ondc/org/item_id": "F1",
            "title": "Packing charges",
            "@ondc/org/title_type": "packing",
            "price": { "currency": "INR", "value": "25.00" }
          },
          {
            "@ondc/org/item_id": "F1",
            "title": "Convenience fee",
            "@ondc/org/title_type": "misc",
            "price": { "currency": "INR", "value": "10.00" }
          },
          {
            "@ondc/org/item_id": "I1",
            "title": "Tax",
            "@ondc/org/title_type": "tax",
            "price": { "currency": "INR", "value": "9.00" }
          }
        ]
      },
      "payment": {
        "@ondc/org/buyer_app_finder_fee_type": "percent",
        "@ondc/org/buyer_app_finder_fee_amount": "3",
        "type": "ON-ORDER",
        "collected_by": "BAP",
        "status": "PAID",
        "transaction_id": "hdfc_txn_abc123", // HDFC's PG reference, NOT ONDC transaction_id
        "paid_amount": "264.00"
      }
    }
  }
}
```

### 4.2 With Fulfillment Time Slot

When buyer selected a delivery window in `/init` and BPP confirmed it in `/on_init`:

```json
{
  "fulfillments": [
    {
      "id": "F1",
      "type": "Delivery",
      "end": {
        "time": {
          "range": {
            "start": "2023-06-03T10:00:00.000Z",
            "end": "2023-06-03T11:00:00.000Z"
          }
        },
        "location": { "gps": "...", "address": { ... } },
        "contact": { "phone": "9886098860" }
      }
    }
  ]
}
```

### 4.3 With Offer Applied

When an offer was selected in `/select` and BPP echoed it in `/on_init`. The quote from `/on_init`
already includes the offer breakup; `/confirm` echoes the same quote:

```json
// Quote from /on_init (with offer applied) — echoed verbatim in /confirm
{
  "quote": {
    "price": { "currency": "INR", "value": "254.00" },
    "breakup": [
      {
        "@ondc/org/item_id": "I1", "@ondc/org/title_type": "item",
        "title": "Farm House Pizza",
        "price": { "currency": "INR", "value": "170.00" }
      },
      {
        "@ondc/org/item_id": "F1", "title": "Delivery charges",
        "@ondc/org/title_type": "delivery",
        "price": { "currency": "INR", "value": "50.00" }
      },
      { ... packing, tax ... },
      {
        "@ondc/org/item_id": "I1", "title": "Offer Discount",
        "@ondc/org/title_type": "discount",
        "price": { "currency": "INR", "value": "-10.00" }
      }
    ]
  },
  "payment": {
    // paid_amount: "254.00" — includes offer discount
    "paid_amount": "254.00",
    ...
  }
}
```

---

## 5. /on_confirm Response — Payload Schema

```
context (required — echoes /confirm context, action changes to "on_confirm")
  domain            "ONDC:RET11"
  action            "on_confirm"
  transaction_id    same as /confirm
  message_id        same as /confirm
  timestamp         BPP processing time
  bpp_id            BPP subscriber ID
  bpp_uri           BPP endpoint URL

message.order (required)

  id                string — echoed from /confirm order.id
  state             "Accepted"  — OR "Created" (if deferred) OR "Cancelled" (BPP rejected)
  provider
    id              string
    locations[]
      id            string

  items[]           — echoed from /confirm (unchanged)

  billing           — echoed from /confirm (unchanged)

  fulfillments[]    — fulfillment with confirmed state
    id              string
    type            "Delivery"
    @ondc/org/provider_name  string?
    tracking        boolean
    @ondc/org/category       string?
    @ondc/org/TAT   string? — confirmed TAT
    state
      descriptor
        code        "Accepted" | "Pending" — if deferred, may still be "Pending"
    end
      location
        gps          string
        address
          ...
      contact
        phone        string
        email        string?
      time
        range
          start      ISO8601 UTC? — confirmed slot (if any)
          end        ISO8601 UTC?

  quote             — echoed from /confirm (unchanged — verbatim from /on_init)

  payment           — echoed from /confirm
    @ondc/org/buyer_app_finder_fee_type    "percent"
    @ondc/org/buyer_app_finder_fee_amount  "3"
    type            "ON-ORDER"
    collected_by    "BAP"
    status          "PAID"
    transaction_id  string — echoed from /confirm (PG reference)
    paid_amount     string — echoed from /confirm

  created_at        ISO8601 UTC — BPP's order creation timestamp
  updated_at        ISO8601 UTC — BPP's last update timestamp
```

---

## 6. /on_confirm Scenarios

### 6.1 Order Accepted Immediately

BPP accepts the order and transitions state to `"Accepted"`. Fulfillment begins.

```json
{
  "context": {
    "domain": "ONDC:RET11",
    "action": "on_confirm",
    "transaction_id": "T2",
    "message_id": "M4",
    "bpp_id": "sellerNP.com",
    "bpp_uri": "https://sellerNP.com/ondc",
    "timestamp": "2023-06-03T08:45:30.000Z"
  },
  "message": {
    "order": {
      "id": "O1-uuid-generated-by-BAP",
      "state": "Accepted",
      "provider": { "id": "P1", "locations": [{ "id": "L1" }] },
      "items": [
        { "id": "I1", "fulfillment_id": "F1", "quantity": { "count": 1 } }
      ],
      "billing": { ... },
      "fulfillments": [
        {
          "id": "F1",
          "type": "Delivery",
          "@ondc/org/provider_name": "LSP Name",
          "tracking": false,
          "@ondc/org/category": "Immediate Delivery",
          "@ondc/org/TAT": "PT60M",
          "state": { "descriptor": { "code": "Accepted" } },
          "end": {
            "location": { "gps": "...", "address": { ... } },
            "contact": { "phone": "9886098860" }
          }
        }
      ],
      "quote": { ... },  // verbatim from /confirm
      "payment": {
        "@ondc/org/buyer_app_finder_fee_type": "percent",
        "@ondc/org/buyer_app_finder_fee_amount": "3",
        "type": "ON-ORDER",
        "collected_by": "BAP",
        "status": "PAID",
        "transaction_id": "hdfc_txn_abc123",
        "paid_amount": "264.00"
      },
      "created_at": "2023-06-03T08:45:30.000Z",
      "updated_at": "2023-06-03T08:45:30.000Z"
    }
  }
}
```

### 6.2 Order Accepted with TAT Deferral

BPP accepts but cannot commit to immediate fulfillment. State remains `"Pending"` with a confirmed
TAT. BAP should poll `/status` until state transitions to `"Accepted"`.

```json
{
  "message": {
    "order": {
      "id": "O1-uuid",
      "state": "Pending",
      "fulfillments": [
        {
          "id": "F1",
          "type": "Delivery",
          "state": { "descriptor": { "code": "Pending" } },
          "@ondc/org/TAT": "PT2H" // deferred — check back in 2 hours
        }
      ]
    }
  }
}
```

### 6.3 BPP Returns Error in /on_confirm

BPP rejects the order. This is rare for a validated + paid order, but can happen if BPP's
internal systems have an issue after `/on_init`.

```json
{
  "message": { "ack": { "status": "NACK" } },
  "error": {
    "type": "DOMAIN-ERROR",
    "code": "40001", // BPP-specific error
    "message": "Order could not be accepted due to a technical issue"
  }
}
```

**BAP response to /on_confirm NACK**:

```
PG payment already collected → DO NOT refund automatically
→ Retry /confirm up to 3 times with same order.id and message_id (idempotent)
→ If still failing after 3 retries:
    → escalate to IGM (Interfacing Grievance Mechanism)
    → show buyer: "Order confirmation delayed — our team is resolving this"
→ PG refund only if IGM results in order cancellation
```

---

## 7. Order State Machine

```
/confirm sent (state="Created" in request)
        │
        ▼
BPP /on_confirm received
        │
        ├── state="Accepted"   → fulfillment begins
        │                           │
        │                           ▼
        │                      fulfillment states:
        │                      Pending → Packed → Order-picked-up
        │                                           → Out-for-delivery
        │                                           → Order-delivered
        │
        └── state="Pending" (deferred)
                │
                ▼
            poll /status
                │
                ▼
            BPP /on_confirm or /on_status
            with state="Accepted"
```

### Fulfillment State Progression

| BPP /on_status `code` | Meaning                                | Who sends         |
| --------------------- | -------------------------------------- | ----------------- |
| `Pending`             | Order accepted; food being prepared    | BPP               |
| `Packed`              | Food ready; waiting for delivery agent | BPP               |
| `Order-picked-up`     | Delivery agent collected the order     | BPP               |
| `Out-for-delivery`    | En route to buyer                      | BPP               |
| `Order-delivered`     | Successfully delivered                 | BPP               |
| `Cancelled`           | Order cancelled                        | BPP (unsolicited) |

### BAP Order State (internal tracking)

| Internal State        | Meaning                                   |
| --------------------- | ----------------------------------------- |
| `payment_pending`     | Waiting for PG callback                   |
| `payment_charged`     | PG confirmed; ready to send /confirm      |
| `confirm_sent`        | /confirm sent; awaiting /on_confirm       |
| `confirmed`           | /on_confirm received with state=Accepted  |
| `fulfillment_pending` | Order accepted; awaiting first /on_status |
| `in_delivery`         | /on_status received: Packed or later      |
| `delivered`           | /on_status received: Order-delivered      |
| `cancelled`           | /on_cancel received from BPP              |

---

## 8. Unsolicited on_status — BPP-Initiated Updates

BPPs can send `/on_status` at any time without a BAP `/status` request. These are **unsolicited**
callbacks for state updates. BAP must accept and process them regardless of whether a `/status`
request was sent.

### Unsolicited /on_status Schema

```json
{
  "context": {
    "domain": "ONDC:RET11",
    "action": "on_status",
    "transaction_id": "T2",
    "message_id": "msg-uuid",
    "bpp_id": "sellerNP.com",
    "bpp_uri": "https://sellerNP.com/ondc",
    "timestamp": "2023-06-03T09:00:00.000Z"
  },
  "message": {
    "order": {
      "id": "O1-uuid",
      "state": "Accepted", // or any fulfillment state
      "fulfillments": [
        {
          "id": "F1",
          "type": "Delivery",
          "state": {
            "descriptor": {
              "code": "Packed", // fulfillment state update
              "name": "Packed"
            }
          },
          "tracking": false,
          "end": {
            "time": {
              "range": {
                "start": "2023-06-03T10:00:00.000Z",
                "end": "2023-06-03T10:30:00.000Z"
              }
            }
          }
        }
      ],
      "updated_at": "2023-06-03T09:00:00.000Z"
    }
  }
}
```

### BAP Processing for Unsolicited /on_status

```
receive unsolicited /on_status
│
├─ 1. Verify Ed25519 signature
│
├─ 2. Validate context: action === "on_status", transaction_id matches known order
│
├─ 3. ACK immediately
│
└─ 4. Update internal order state machine:
   │
   ├─ fulfillment.state.code === "Pending"    → state = "fulfillment_pending"
   ├─ fulfillment.state.code === "Packed"     → state = "in_delivery"
   ├─ fulfillment.state.code === "Order-picked-up" → state = "in_delivery"
   ├─ fulfillment.state.code === "Out-for-delivery" → state = "in_delivery"
   ├─ fulfillment.state.code === "Order-delivered" → state = "delivered"
   │
   └─ Push state update to frontend via SSE (if applicable)
```

---

## 9. Enum Reference Tables

### Order `state` values

| Value         | Where                        | Meaning                                   |
| ------------- | ---------------------------- | ----------------------------------------- |
| `"Created"`   | `/confirm` (BAP sets)        | Order committed by BAP with payment proof |
| `"Accepted"`  | `/on_confirm` (BPP sets)     | BPP accepted; fulfillment begins          |
| `"Pending"`   | `/on_confirm` / `/on_status` | Deferred acceptance; BAP should poll      |
| `"Cancelled"` | `/on_cancel` (BPP sets)      | Order cancelled (buyer or BPP-initiated)  |

### Fulfillment `state.descriptor.code` values

| Value                | Meaning                                  |
| -------------------- | ---------------------------------------- |
| `"Pending"`          | Order received; food being prepared      |
| `"Packed"`           | Food ready; awaiting delivery agent      |
| `"Agent-assigned"`   | Delivery agent assigned (optional state) |
| `"Order-picked-up"`  | Delivery agent collected the order       |
| `"Out-for-delivery"` | En route to buyer                        |
| `"Order-delivered"`  | Successfully delivered                   |
| `"Cancelled"`        | Fulfillment cancelled                    |

### Payment `status` in /confirm (BAP-collected prepaid)

| Value    | When                                              |
| -------- | ------------------------------------------------- |
| `"PAID"` | Always — BAP has already collected payment via PG |

### Payment `collected_by` in /confirm

| Value   | When                                                  |
| ------- | ----------------------------------------------------- |
| `"BAP"` | Always — this project does not support BPP collection |

---

## 10. Idempotency and Order Identity

### Order ID — BAP-Generated, Network-Unique

> **Rule (ONDC Contract)**: Buyer NP creates the `order.id` which is **unique across the network**.
> This is the first appearance of `order.id` — it does not exist before `/confirm`.

- `order.id` is a BAP-generated UUID — NOT the same as `transaction_id`
- The same `order.id` must be reused on retry (idempotency key)
- `order.id` echoed back verbatim by BPP in `/on_confirm` — must match what was sent
- Once an `order.id` is assigned, it persists across all subsequent API calls for that order

### Idempotency Rules

Both `/confirm` and `/on_confirm` are **idempotent** by design:

- **BAP sending `/confirm`**: Same `order.id` + `message_id` = same order. BPP must not create duplicate orders.
- **BPP sending `/on_confirm`**: Same `order.id` = same order acknowledgment. BAP must not create duplicate records.

If BAP retries `/confirm` after a timeout (no ACK/NACK received), reuse the same `order.id`.

---

## 11. SNP/BPP Validation of `/confirm` — What Happens on the BPP Side

> This section describes BPP behavior when it receives `/confirm`. Understanding this is essential
> for BAP retry logic and error handling — BAP must know what errors the BPP can return and why.

### BPP Processing Steps (SNP side)

When BPP receives `/confirm`:

1. **Validate the order** — check items, quantities, prices, fulfillment, billing
2. **If validation succeeds**:
   - Respond with **ACK** immediately
   - Create order internally (with internal state to indicate "being processed")
   - **Do NOT forward to merchant/fulfillment engine yet** — order is accepted but not committed
3. **If validation fails**:
   - Respond with **NACK** + error code `31002` (order validation failure)
4. **If internal error** (HTTP 504 gateway timeout, or retriable error code `31001`):
   - Respond with **NACK** + `31001` (retryable)
   - BAP should **retry `/confirm`** with same `order.id`

### BPP Error Codes on `/confirm` (SNP → BNP)

| Code    | Type                     | Meaning                                                                          | BNP/BAP Action                                     |
| ------- | ------------------------ | -------------------------------------------------------------------------------- | -------------------------------------------------- |
| `31002` | ORDER-VALIDATION-FAILURE | Order validation failed (items, qty, price, fulfillment, billing — any mismatch) | Do NOT retry; cancel with reason `999`             |
| `31001` | RETRYABLE                | Internal error or gateway timeout — safe to retry                                | Retry `/confirm` with same `order.id` (idempotent) |
| `30018` | ORDER-NOT-FOUND          | `order.id` not found at SNP — already cancelled or expired                       | Cancel with reason `999`; do not retry             |

### BNP/BAP Escalation When `/confirm` NACKs or Times Out

```
/confirm sent
        │
        ▼
   ACK received? ──yes──→ wait for /on_confirm
        │
        no
        ▼
   NACK received?
        │
        ├──yes── code = 31002 (validation failure)
        │         → do NOT retry
        │         → cancel order with reason code 999
        │         → PG refund if applicable
        │
        ├──yes── code = 31001 (retryable)
        │         → retry /confirm with same order.id
        │         → retry interval: as per TTL (typically PT30S)
        │
        └──no── (timeout: no ACK/NACK received)
                  → retry /confirm with same order.id
                  → if still no ACK/NACK within retry interval
                    → cancel order with reason code 999
```

### Cancellation Reason Code 999 — BNP→SNP (BAP-initiated)

Used when BAP must cancel after `/confirm` failure:

| Reason Code | Phase                      | When Used                                                       |
| ----------- | -------------------------- | --------------------------------------------------------------- |
| `999`       | Order Confirmation Failure | BNP receives NACK with 31002, or timeout after retry exhaustion |

> See `init-on-init.md` §10 for the full cancellation reason code table.

---

## 12. BNP/BAP Validation of `/on_confirm` — What Happens on the BAP Side

> This section describes BAP behavior when it receives `/on_confirm`. The BAP must validate the
> callback and handle error cases according to ONDC contract rules.

### BAP Processing Steps (upon receiving `/on_confirm`)

1. **Validate the callback** — verify signature, check `order.id` matches what was sent
2. **If validation succeeds**:
   - Respond with **ACK** immediately
   - Forward order to merchant/fulfillment engine
3. **If validation fails** (e.g., BPP returned error code `23002`):
   - Respond with **NACK** + error code `23002` (order validation failure at BNP side)
   - After SNP receives NACK → SNP cancels with reason code `998`

### BPP/SNP Escalation When `/on_confirm` NACKs (SNP side)

```
SNP sends /on_confirm
        │
        ▼
   ACK received by SNP? ──yes──→ forward order to merchant/fulfillment
        │
        no
        ▼
   NACK received? ( BNP detected validation error at its end )
        │
        └──yes── SNP receives NACK with code 23002
                  → SNP cancels order with reason code 998
                  → SNP pushes status change (Cancelled) to BNP

   NACK due to SNP internal error (HTTP 504/503, retriable code 23001)?
        │
        └──yes── SNP retries /on_confirm with same order.id
                  → if order passed in subsequent calls within retry window
                    → SNP responds with current order state + error 31003
                    ("order processing in progress — do not cancel")
                  → if still no ACK after retry interval
                    → SNP cancels with reason code 998
```

### What BAP Does When `/on_confirm` Never Arrives (SNP perspective — BPP retry)

> This is SNP retry logic. BNP does not control SNP retry behavior, but must handle the
> `/on_confirm` callback correctly regardless of timing.

### BAP Cancellation Reason Code 998 — SNP→BNP (BPP-initiated)

Used when SNP cancels due to receiving NACK on `/on_confirm` or exhausting its retry interval:

| Reason Code | Phase                                      | When Used                                                                            |
| ----------- | ------------------------------------------ | ------------------------------------------------------------------------------------ |
| `998`       | Order Confirmation Failure (BPP-initiated) | SNP received NACK (23002) from BNP on `/on_confirm`, or SNP exhausted retry interval |

When BAP receives `/on_cancel` with reason `998`:

- Order was cancelled during confirmation phase
- No fulfillment was ever started
- BAP should process PG refund if payment was collected
- BAP responds with **ACK** to `/on_cancel` (order already in cancelled state)

---

## 13. Retry + Cancel Decision Tree (Full View)

```
BAP ── /confirm ──→ BPP
         │
         ├── ACK ──────────────────────────→ wait for /on_confirm
         │
         ├── NACK(31002) ──────────────────→ cancel(999), no retry
         │
         ├── NACK(31001) ──────────────────→ retry /confirm (same order.id)
         │                                     │
         │                              still NACK or timeout?
         │                                     │
         │                              ──yes──→ cancel(999)
         │
         └── timeout (no ACK/NACK) ────────────→ retry /confirm (same order.id)
                                                   │
                                            still timeout?
                                                   │
                                            ──yes──→ cancel(999)
```

---

## 14. Error Codes

### Errors in /on_confirm (BPP → BAP)

| Code    | Type                         | Meaning                                                                     | BAP Action                                                   |
| ------- | ---------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `23002` | ORDER-VALIDATION-FAILURE     | BNP (BAP) returned NACK because `/on_confirm` validation failed at BNP side | SNP cancels with reason `998`; BAP processes refund          |
| `23001` | RETRYABLE                    | SNP internal error on `/on_confirm` — SNP retries                           | Wait; SNP will resend `/on_confirm`                          |
| `31003` | ORDER-PROCESSING-IN-PROGRESS | Order passed in subsequent calls within SNP retry window                    | SNP responding with current state + this code; do not cancel |
| `40001` | DOMAIN-ERROR                 | Order could not be accepted (BPP internal error)                            | Retry /confirm up to 3×; escalate to IGM if persistent       |
| `40002` | DOMAIN-ERROR                 | Item out of stock (post-init, rare)                                         | Abort; refund via PG                                         |
| `30023` | DOMAIN-ERROR                 | Minimum order value not met                                                 | Inform buyer; abort                                          |
| `30018` | ORDER-NOT-FOUND              | `order.id` not found — already cancelled or expired at BPP                  | Cancel with reason `999`; do not retry                       |
| `31001` | RETRYABLE                    | SNP internal error on `/confirm` — safe to retry                            | Retry `/confirm` with same `order.id`                        |
| `31002` | ORDER-VALIDATION-FAILURE     | `/confirm` validation failed at BPP side                                    | Do NOT retry; cancel with reason `999`                       |
| `22502` | DOMAIN-ERROR                 | Invalid cancellation reason                                                 | N/A for confirm                                              |

### NACK response shape

```json
{
  "message": { "ack": { "status": "NACK" } },
  "error": {
    "type": "DOMAIN-ERROR",
    "code": "40001",
    "message": "Order could not be accepted due to a technical issue"
  }
}
```

### ACK response shape (success)

```json
{
  "message": { "ack": { "status": "ACK" } }
}
```

### BPP-Initiated Cancellation — /on_cancel

BPP can send unsolicited `/on_cancel` at any time. See `init-on-init.md` §10 for reason codes.

---

## 15. BAP Processing Algorithm for /on_confirm

```
receive /on_confirm webhook
│
├─ 1. Verify Ed25519 signature
│      HTTP 401 NACK if invalid
│
├─ 2. Validate context
│      action == "on_confirm"
│      order.id present
│      transaction_id matches open order session
│      NACK 200 DOMAIN-ERROR if invalid
│
├─ 3. ACK immediately (200 OK with ACK body) — processing is async
│
└─ 4. Async processing:
   │
   ├─ 4a. Check for BPP error in /on_confirm
   │       error present → /on_confirm NACK
   │         → do NOT refund (payment already collected)
   │         → retry /confirm up to 3× with same order.id
   │         → if 3 retries fail → escalate to IGM
   │         → PG refund only if IGM resolves to cancellation
   │
   ├─ 4b. Validate order state
   │       state === "Accepted" → fulfillment begins; push to frontend
   │       state === "Pending" → order deferred; poll /status every 30s
   │       state === "Created" → BPP echoed our request state; treat as "Accepted"
   │
   ├─ 4c. Validate echoed fields
   │       order.id === BAP-generated ID (matches what was sent in /confirm)
   │       payment.status === "PAID" (echoed)
   │       payment.collected_by === "BAP" (echoed)
   │       quote === verbatim from /on_init (echoed — no changes expected)
   │       If any mismatch → log; alert engineering; continue (BPP echoes what we sent)
   │
   ├─ 4d. Update internal order state = "confirmed"
   │
   ├─ 4e. Push /on_confirm SSE event to frontend
   │       { transaction_id, status, onConfirmData }
   │
   └─ 4f. Start /status polling loop (if state === "Pending")
           poll GET /status?transaction_id=... every 30s
           stop polling when state === "Accepted" or "Cancelled"
           on /on_status: update fulfillment state; push to frontend
           on /on_cancel: update state = "cancelled"; push to frontend; handle refund
```

---

## 16. Complete Example — Full /confirm Request

```json
{
  "context": {
    "domain": "ONDC:RET11",
    "action": "confirm",
    "core_version": "1.2.0",
    "bap_id": "buyerNP.com",
    "bap_uri": "https://buyerNP.com/ondc",
    "bpp_id": "sellerNP.com",
    "bpp_uri": "https://sellerNP.com/ondc",
    "transaction_id": "T2",
    "message_id": "M4",
    "city": "std:080",
    "country": "IND",
    "timestamp": "2023-06-03T08:45:00.000Z",
    "ttl": "PT30S"
  },
  "message": {
    "order": {
      "id": "ord_b9aa2a3c-7e1f-4d2b-9f1a-3c5e8f7d6a2b",
      "state": "Created",
      "provider": { "id": "P1", "locations": [{ "id": "L1" }] },
      "items": [
        {
          "id": "I1",
          "fulfillment_id": "F1",
          "location_id": "L1",
          "quantity": { "count": 1 }
        }
      ],
      "billing": {
        "name": "Buyer Name",
        "address": {
          "name": "My Apartment",
          "building": "Tower A",
          "locality": "Koramangala",
          "city": "Bengaluru",
          "state": "Karnataka",
          "country": "IND",
          "area_code": "560034"
        },
        "email": "buyer@example.com",
        "phone": "9886098860",
        "created_at": "2023-06-03T08:30:00.000Z",
        "updated_at": "2023-06-03T08:30:00.000Z"
      },
      "fulfillments": [
        {
          "id": "F1",
          "type": "Delivery",
          "@ondc/org/provider_name": "LSP Name",
          "tracking": false,
          "@ondc/org/category": "Immediate Delivery",
          "@ondc/org/TAT": "PT60M",
          "state": { "descriptor": { "code": "Pending" } },
          "end": {
            "location": {
              "gps": "12.453544,77.928379",
              "address": {
                "name": "My Apartment",
                "building": "Tower A",
                "locality": "Koramangala",
                "city": "Bengaluru",
                "state": "Karnataka",
                "country": "IND",
                "area_code": "560034"
              }
            },
            "contact": { "phone": "9886098860", "email": "buyer@example.com" }
          }
        }
      ],
      "quote": {
        "price": { "currency": "INR", "value": "264.00" },
        "breakup": [
          {
            "@ondc/org/item_id": "I1",
            "@ondc/org/item_quantity": { "count": 1 },
            "title": "Farm House Pizza",
            "@ondc/org/title_type": "item",
            "price": { "currency": "INR", "value": "170.00" },
            "item": {
              "quantity": {
                "available": { "count": "99" },
                "maximum": { "count": "99" }
              },
              "price": { "currency": "INR", "value": "170.00" }
            }
          },
          {
            "@ondc/org/item_id": "F1",
            "title": "Delivery charges",
            "@ondc/org/title_type": "delivery",
            "price": { "currency": "INR", "value": "50.00" }
          },
          {
            "@ondc/org/item_id": "F1",
            "title": "Packing charges",
            "@ondc/org/title_type": "packing",
            "price": { "currency": "INR", "value": "25.00" }
          },
          {
            "@ondc/org/item_id": "F1",
            "title": "Convenience fee",
            "@ondc/org/title_type": "misc",
            "price": { "currency": "INR", "value": "10.00" }
          },
          {
            "@ondc/org/item_id": "I1",
            "title": "Tax",
            "@ondc/org/title_type": "tax",
            "price": { "currency": "INR", "value": "9.00" }
          }
        ]
      },
      "payment": {
        "@ondc/org/buyer_app_finder_fee_type": "percent",
        "@ondc/org/buyer_app_finder_fee_amount": "3",
        "type": "ON-ORDER",
        "collected_by": "BAP",
        "status": "PAID",
        "transaction_id": "hdfc_txn_abc123",
        "paid_amount": "264.00"
      }
    }
  }
}
```

---

## Quick Reference — /confirm + /on_confirm

**BAP sends in /confirm** (all mandatory for BAP-collected prepaid):

- `context.action = "confirm"`, `ttl = "PT30S"`, same `transaction_id` as all prior steps
- `message.order.id` = BAP-generated UUID (NOT `transaction_id`; first time `order.id` appears)
- `message.order.state = "Created"` — always, BPP transitions
- `quote` = verbatim from `/on_init` (unchanged, unmodified)
- `payment.status = "PAID"` + `payment.transaction_id` = PG reference + `payment.paid_amount` = frozen quote value
- `fulfillments` = echoed from `/on_init` (with BPP-confirmed values)

**BAP receives in /on_confirm** (critical):

- `order.state = "Accepted"` → fulfillment begins; push SSE; stop PG polling
- `order.state = "Pending"` → poll `/status` every 30s until Accepted or Cancelled
- Error/NACK → do NOT refund; retry /confirm up to 3×; escalate to IGM if persistent

**Never do in /confirm**:

- Do NOT send `order.id = transaction_id` — these are different IDs
- Do NOT modify `quote` after `/on_init` — echo it verbatim
- Do NOT send `payment.status = "NOT-PAID"` — always `"PAID"` (already collected)
- Do NOT re-trigger PG after payment already succeeded
- Do NOT refund automatically on BPP NACK — retry + IGM first
