# /status + /on_status Deep Reference

**Scope**: BAP-collected prepaid (ON-ORDER) only. Delivery fulfillment only.

**When to read this**: Implementing or debugging anything related to order tracking, polling,
fulfillment state progression, TAT breach handling, unsolicited updates, or cancellation during
fulfillment.

---

## Table of Contents

1. [Overview](#1-overview)
2. [/status — BAP Sends](#2-status--bap-sends)
3. [/on_status — BPP Returns](#3-on_status--bpp-returns)
4. [Fulfillment State Progression](#4-fulfillment-state-progression)
5. [BAP Polling Algorithm](#5-bap-polling-algorithm)
6. [TAT Tracking and Breach](#6-tat-tracking-and-breach)
7. [Cancellation During Fulfillment](#7-cancellation-during-fulfillment)
8. [Unsolicited /on_status](#8-unsolicited-on_status)
9. [Error Codes](#9-error-codes)
10. [Schema Reference](#10-schema-reference)

---

## 1. Overview

After `/on_confirm` with `order.state: "Accepted"` (or after BAP begins polling on `"Pending"`),
BAP uses `/status` to poll for fulfillment state updates. BPP returns the full current order object
with all fulfillments annotated with their current states.

**Primary channel**: BPP sends unsolicited `/on_status` callbacks as state changes occur.
BAP MUST poll `/status` as a fallback — if the SSE stream drops or BPP never sent an unsolicited
callback, polling ensures the buyer always sees current tracking status.

**When to poll**:
- After `/on_confirm` with `state: "Pending"` — poll every 30 s until `Accepted` or `Cancelled`
- After TAT breach — verify actual state before force-cancelling
- After SSE disconnection — resume polling to catch missed updates
- Optional (reduces latency): Poll every 60 s during active delivery even if SSE is connected

**When NOT to poll**:
- After `state: "Delivered"` — terminal state, no more updates possible
- After `state: "Cancelled"` — terminal state

---

## 2. /status — BAP Sends

### Schema

```json
{
  "context": {
    "domain": "ONDC:RET11",
    "action": "status",
    "transaction_id": "<transaction_id from /select>",
    "message_id": "<uuid>",
    "bpp_id": "<seller NP ID>",
    "bpp_uri": "https://<seller NP>/ondc",
    "timestamp": "<ISO 8601>"
  },
  "message": {
    "order_id": "<BAP-generated order UUID from /confirm>"
  }
}
```

### Field Requirements

| Field | Rule |
|---|---|
| `order_id` | Must be the BAP-generated UUID from `/confirm`, NOT the BPP's internal order ID |

### Polling Intervals (Recommended)

| Scenario | Interval | Stop When |
|---|---|---|
| `Pending` after `/on_confirm` | Every 30 s | `Accepted` or `Cancelled` |
| `Accepted`, no `/on_status` yet | Every 60 s | First `/on_status` received |
| Active delivery (`Pending`/`Packed`/`Order-picked-up`/`Out-for-delivery`) | Every 60 s | `Delivered` or `Cancelled` |
| TAT breach (confirmed) | Every 60 s until response | Any state change or force-cancel decision |

---

## 3. /on_status — BPP Returns

BPP returns the full current order object. The order may contain multiple fulfillments (delivery,
pickup, etc.). Each fulfillment carries its own `state.descriptor.code` reflecting the latest
stage of that fulfillment's journey.

### Full Schema

```json
{
  "context": {
    "domain": "ONDC:RET11",
    "action": "on_status",
    "transaction_id": "<transaction_id>",
    "message_id": "<uuid>",
    "bpp_id": "<seller NP ID>",
    "bpp_uri": "https://<seller NP>/ondc",
    "timestamp": "<ISO 8601>"
  },
  "message": {
    "order": {
      "id": "<BAP-generated order UUID>",
      "state": "Accepted",          // or "Pending", "Cancelled"
      "provider": { ... },          // full provider object
      "items": [ ... ],            // all order items with fulfillment_ids
      "billing": { ... },          // billing address
      "fulfillments": [
        {
          "id": "F1",
          "type": "Delivery",
          "tracking": false,
          "state": {
            "descriptor": {
              "code": "Packed",    // see §4 — fulfillment state codes
              "name": "Food Packed"
            }
          },
          "start": {
            "location": {
              "descriptor": { "name": "Pizza Hut - Indiranagar" },
              "gps": "12.9716,77.5946"
            },
            "time": {
              "range": {
                "start": "2023-06-03T10:00:00.000Z",
                "end": "2023-06-03T10:30:00.000Z"
              }
            }
          },
          "end": {
            "location": {
              "descriptor": { "name": "Delivery address" },
              "gps": "12.9355,77.6245",
              "address": {
                "street": "23/1, 3rd Floor",
                "locality": "Indiranagar",
                "city": "Bengaluru",
                "state": "Karnataka",
                "country": "IND",
                "area_code": "560038"
              }
            },
            "contact": {
              "phone": "+919876543210",
              "email": "buyer@example.com"
            },
            "person": { "name": "Ravi Kumar" }
          },
          "agent": {
            "name": "Rajesh",
            "phone": "+919876543211",
            "image": "https://..."
          },
          "tags": [
            {
              "code": "timeline",
              "list": [
                { "code": "ready_for_pickup_time", "value": "2023-06-03T09:45:00.000Z" },
                { "code": "pickup_time", "value": "2023-06-03T10:05:00.000Z" },
                { "code": "delivery_time", "value": "2023-06-03T10:25:00.000Z" }
              ]
            }
          ]
        }
      ],
      "quote": {
        "price": { "currency": "INR", "value": "549.00" },
        "breakup": [ ... ],
        "ttl": "PT45M"
      },
      "payment": {
        "params": {
          "amount": "549.00",
          "currency": "INR",
          "transaction_id": "<pg txn ref>",
          "bank_code": "HDFC"
        },
        "status": "PAID",
        "type": "ON-ORDER",
        "collected_by": "BAP"
      },
      "created_at": "<timestamp>",
      "updated_at": "<timestamp>"
    }
  }
}
```

### Key Field Rules

| Field | Rule |
|---|---|
| `order.id` | Must echo the BAP-generated UUID from `/confirm` |
| `order.state` | BPP sets to `"Accepted"` once merchant accepts; stays there for duration |
| `fulfillments[].state.descriptor.code` | The primary state update field; see §4 |
| `fulfillments[].agent` | Present once delivery agent is assigned; may be absent in early states |
| `fulfillments[].end` | Buyer address + contact; required for delivery fulfillment |
| `fulfillments[].tags` | Optional timeline tags — `ready_for_pickup_time`, `pickup_time`, `delivery_time` |

---

## 4. Fulfillment State Progression

Each fulfillment (delivery, self-pickup, etc.) progresses through states. The canonical sequence
for a Delivery fulfillment:

```
Pending → Packed → Order-picked-up → Out-for-delivery → Order-delivered
```

### State Code Reference

| Code | Meaning | When It Occurs |
|---|---|---|
| `"Pending"` | Order received; food being prepared in kitchen | After BPP.Accepted; kitchen starts prep |
| `"Packed"` | Food is ready and packed; waiting for delivery agent | Kitchen done; agent not yet assigned/arrived |
| `"Agent-assigned"` | Delivery agent assigned but food not yet picked (optional state) | Agent found; en route to restaurant |
| `"Order-picked-up"` | Agent has collected food from restaurant | Agent at restaurant; food handed over |
| `"Out-for-delivery"` | Agent is en route to buyer | Agent left restaurant; heading to delivery address |
| `"Order-delivered"` | Food delivered to buyer | Agent completed delivery |
| `"Cancelled"` | Fulfillment cancelled (partial or full) | Buyer/BPP cancelled; see §7 |

### Item-Level Fulfillment Tracking

When an order has multiple items and some are fulfilled separately (e.g., partial delivery), the
fulfillment may be split across multiple fulfillment records. Each item has a `fulfillment_id`
referencing the correct fulfillment.

```json
{
  "items": [
    {
      "id": "I1",
      "fulfillment_id": "F1",
      "quantity": { "count": 2 }
    },
    {
      "id": "I2",
      "fulfillment_id": "F2",
      "quantity": { "count": 1 }
    }
  ],
  "fulfillments": [
    { "id": "F1", "type": "Delivery", "state": { "descriptor": { "code": "Order-delivered" } } },
    { "id": "F2", "type": "Delivery", "state": { "descriptor": { "code": "Packed" } } }
  ]
}
```

BAP renders this as a split shipment — first shipment delivered, second in progress.

---

## 5. BAP Polling Algorithm

```
send /status (transaction_id, order_id)
│
├─ on_ack: record last poll time
│
└─ on/on_status:
   │
   ├─ 1. Verify Ed25519 signature
   │
   ├─ 2. Validate context.action === "on_status"
   │       transaction_id must match known order
   │
   ├─ 3. ACK immediately (200)
   │
   ├─ 4. Validate order.id echoes our order UUID
   │
   ├─ 5. Parse fulfillment states from order.fulfillments[]
   │       Determine highest-priority state across all fulfillments:
   │       "Order-delivered" > "Out-for-delivery" > "Order-picked-up"
   │         > "Packed" > "Agent-assigned" > "Pending"
   │
   ├─ 6. Update internal order state machine:
   │       "Pending" (fulfillment) → push "Order is being prepared" to buyer
   │       "Packed" → push "Food ready, awaiting delivery agent"
   │       "Order-picked-up" → push "Agent picked up food"
   │       "Out-for-delivery" → push "Out for delivery"
   │       "Order-delivered" → push "Delivered!" + stop polling + mark terminal
   │
   ├─ 7. Push SSE event to frontend: { order_id, fulfillment_state, timestamp }
   │
   ├─ 8. Check TAT:
   │       if current_time > order.items[0].time.label (TAT) + 15 min buffer:
   │           if no state change yet → alert buyer of delay + suggest contact support
   │           if still no response after TAT + 1h → force cancel option
   │
   └─ 9. Continue or stop polling:
           state === "Order-delivered" or "Cancelled" → STOP POLLING
           otherwise → reschedule poll in 60 s
```

---

## 6. TAT Tracking and Breach

TAT (Turnaround Time) is set by the BPP in `/on_confirm` or `/on_select`. BAP stores it and uses
it to determine when to alert the buyer or trigger force-cancellation procedures.

### Where TAT Comes From

TAT is set by the BPP in two ways:
1. **` fulfillments[].start.time.range.end`** — absolute delivery window end time
2. **` fulfillments[].end.time.range`** — when the delivery must complete

BAP must calculate expected delivery time from BPP's response and track against actual delivery.

### TAT Breach Decision Tree

```
TAT expired (current_time > TAT + 15min buffer)
│
├─ No state change received yet
│   ├─ Send /status to check current state
│   ├─ If /status returns current state:
│   │     ├─ State progressed normally → update buyer; stop escalation
│   │     └─ Still Pending after TAT → suggest buyer contact support / await further updates
│   └─ No /on_status response to /status poll:
│         ├─ Retry /status up to 3×
│         ├─ After 3 failed polls → force cancel option for buyer
│         └─ Record incident for IGM escalation
│
└─ BPP unresponsive to /cancel after TAT breach
    ├─ Resend /cancel with force:"yes"
    ├─ If still no response → issue IGM
    └─ Log TAT breach incident
```

### Buyer-Facing TAT Messaging

| Scenario | Message |
|---|---|
| Within TAT | "Estimated delivery by [time]" |
| TAT + 0–15 min | "Your order is taking longer than expected. We're checking with the restaurant." |
| TAT + 15–30 min | "Significant delay detected. Contact support for updates or cancellation." |
| TAT + 30+ min | "We've initiated an inquiry. You can cancel without cancellation fee." |

---

## 7. Cancellation During Fulfillment

Cancellation rules change after the order enters fulfillment (`Pending` or later state).

### Cancellation Validity by State

| Order State | Buyer-Initiated Cancel | BPP-Initiated Cancel |
|---|---|---|
| `"Created"` | Always allowed | Always allowed |
| `"Accepted"` | Allowed; no cancellation fee if TAT breached | Allowed |
| `"Pending"` (fulfillment) | Item-level only if state is `"Pending"` | Allowed |
| `"Packed"` or later | NOT allowed via `/cancel` | Allowed (with fee per cancellation_terms) |
| `"Order-picked-up"` or later | NOT allowed | NOT allowed |

### When BPP Sends Cancellation During Fulfillment

BPP may send `/on_cancel` (seller-initiated) even after fulfillment begins. This happens when:
- Restaurant cannot complete the order after accepting it
- Delivery agent unavailable for the route
- Item out of stock mid-fulfillment

Cancellation fees apply as defined in `cancellation_terms` from `/on_init`.

### BAP Response to Mid-Fulfillment /on_cancel

```
receive /on_cancel from BPP during fulfillment
│
├─ 1. Verify Ed25519 signature
│
├─ 2. ACK immediately
│
├─ 3. Parse cancellation_reason_id + updated quote
│
├─ 4. Calculate refund:
│       total charged - cancellation_fee = refund amount
│       if partial cancel → proportional refund
│
├─ 5. Initiate refund via PG (if not already auto-processed)
│       refund to source payment instrument
│       PG refund typically 5–7 business days
│
├─ 6. Notify buyer:
│       "Order cancelled by restaurant. Reason: [reason]. Refund: [amount] in [T+5-7 days]"
│
└─ 7. Log incident for business review
```

### Buyer-Initiated Cancel After TAT Breach

If TAT has passed and the order is still in `Pending` fulfillment state, buyer can cancel without
a cancellation fee. BAP sends:

```json
{
  "message": {
    "order_id": "<order UUID>",
    "cancellation_reason_id": "006",
    "descriptor": {
      "short_desc": "TAT breach"
    }
  }
}
```

Reason code `006` = "Merchant TAT breached — buyer initiated cancellation."

---

## 8. Unsolicited /on_status

BPP may send `/on_status` at any time without BAP first sending `/status`. This is the primary
delivery update mechanism. BAP must accept and process these callbacks the same way as responses
to `/status` polls.

**BAP requirements for unsolicited callbacks**:
1. Webhook endpoint must accept `action: "on_status"` without a matching BAP request record
2. Signature must be verified (Ed25519) — reject with 401 if invalid
3. Process state update and push to frontend immediately
4. Do NOT require a matching `/status` request in the DB to accept the callback

**Race condition handling**:
- If BAP polls `/status` at the same time BPP sends an unsolicited `/on_status`, both may arrive.
  BAP should deduplicate by `message_id` — if already processed, ACK with 200 but skip processing.
- If SSE push and poll result both arrive, prefer the SSE push (faster); discard the redundant poll
  result after processing.

### Full Unsolicited /on_status Processing Algorithm

```
receive /on_status webhook
│
├─ 1. Verify Ed25519 signature → 401 if fail
│
├─ 2. Validate context.action === "on_status"
│       transaction_id must be known (lookup by transaction_id or order_id)
│
├─ 3. ACK immediately (200) — don't wait for DB write
│
├─ 4. Parse order.fulfillments[].state.descriptor.code for each fulfillment
│
├─ 5. Determine aggregate order state:
│       any fulfillment with code "Order-delivered"  → "delivered"
│       any fulfillment with code "Out-for-delivery"  → "in_delivery"
│       any fulfillment with code "Order-picked-up"  → "in_delivery"
│       any fulfillment with code "Packed"            → "in_delivery"
│       any fulfillment with code "Pending"           → "fulfillment_pending"
│       all fulfillments "Cancelled"                  → "cancelled"
│
├─ 6. Check message_id deduplication:
│       if message_id already processed → skip to step 9
│
├─ 7. Persist to DB:
│       update ondc_on_confirm (or ondc_on_status) with latest fulfillment states
│       record message_id, timestamp, fulfillment state codes
│
├─ 8. Push SSE event to frontend:
│       { transaction_id, order_id, fulfillment_state, agent?, timestamp }
│       fulfillment_state codes:
│         "fulfillment_pending" → "Order accepted, being prepared"
│         "in_delivery" → "Out for delivery"
│         "delivered" → "Order delivered"
│         "cancelled" → "Order cancelled"
│
└─ 9. Continue or stop polling:
        if state === "delivered" or "cancelled" → STOP POLLING (terminal)
        otherwise → if BAP was polling, reschedule next poll in 60 s
```

---

## 9. Error Codes

### /status Error Codes (BPP → BAP)

| Code | Message | BAP Action |
|---|---|---|
| `40001` | Order not found | Order ID may be wrong; verify from /confirm response |
| `40002` | Item not available | Notify buyer; offer replacement or cancellation |
| `40003` | Invalid order state for requested action | Order may have been cancelled; stop polling |
| `40004` | BPP not reachable | Retry with backoff; alert if persistent |
| `40005` | Invalid transaction_id | Log error; transaction_id may be stale |

### /on_status NACK Codes (BPP → BAP via IGM)

| Code | Message | BAP Action |
|---|---|---|
| `23001` | Invalid order state | Order may have changed; re-fetch with /status |
| `23002` | Order cancelled by SNP | Process refund; notify buyer |
| `23003` | Invalid provider | Escalate to engineering |
| `31003` | SNP retry in progress | Do NOT cancel; wait for retry to complete |

### BAP Status Poll Timeout

| Scenario | Action |
|---|---|
| `/status` times out (no response in 30 s) | Retry up to 3× with exponential backoff |
| After 3 failures | Stop polling; alert buyer; mark as "status unavailable" |
| Persistent failure after `Accepted` | Log incident; consider force cancel if TAT breached |

---

## 10. Schema Reference

### /status Request (BAP → BPP)

```json
{
  "context": {
    "domain": "ONDC:RET11",
    "action": "status",
    "transaction_id": "string (required, from /select)",
    "message_id": "string (required, uuid)",
    "bpp_id": "string (required)",
    "bpp_uri": "string (required)",
    "timestamp": "string (required, ISO 8601)"
  },
  "message": {
    "order_id": "string (required, BAP-generated UUID from /confirm)"
  }
}
```

### /on_status Response (BPP → BAP)

```json
{
  "context": {
    "domain": "ONDC:RET11",
    "action": "on_status",
    "transaction_id": "string",
    "message_id": "string",
    "bpp_id": "string",
    "bpp_uri": "string",
    "timestamp": "string"
  },
  "message": {
    "order": {
      "id": "string",
      "state": "string (Accepted|Pending|Cancelled)",
      "provider": { "id": "string", "descriptor": { "name": "string" } },
      "items": [
        {
          "id": "string",
          "fulfillment_id": "string",
          "quantity": { "count": "number" }
        }
      ],
      "billing": {
        "name": "string",
        "address": { "street": "string", "locality": "string", "city": "string", "state": "string", "country": "string", "area_code": "string" },
        "phone": "string",
        "email": "string"
      },
      "fulfillments": [
        {
          "id": "string",
          "type": "Delivery|Self-Pickup",
          "tracking": "boolean",
          "state": {
            "descriptor": {
              "code": "Pending|Packed|Agent-assigned|Order-picked-up|Out-for-delivery|Order-delivered|Cancelled",
              "name": "string"
            }
          },
          "start": {
            "location": { "descriptor": { "name": "string" }, "gps": "string" },
            "time": { "range": { "start": "string", "end": "string" } }
          },
          "end": {
            "location": {
              "descriptor": { "name": "string" },
              "gps": "string",
              "address": { "street": "string", "locality": "string", "city": "string", "state": "string", "country": "string", "area_code": "string" }
            },
            "contact": { "phone": "string", "email": "string" },
            "person": { "name": "string" }
          },
          "agent": {
            "name": "string",
            "phone": "string",
            "image": "string (optional)"
          },
          "tags": [
            {
              "code": "string (timeline|metadata)",
              "list": [
                { "code": "string", "value": "string" }
              ]
            }
          ]
        }
      ],
      "quote": {
        "price": { "currency": "INR", "value": "string" },
        "breakup": [
          {
            "@ondc/org/item_id": "string",
            "@ondc/org/item_quantity": { "count": "number" },
            "title": "string",
            "@ondc/org/title_type": "string",
            "price": { "currency": "INR", "value": "string" }
          }
        ],
        "ttl": "string (ISO 8601 duration)"
      },
      "payment": {
        "params": {
          "amount": "string",
          "currency": "INR",
          "transaction_id": "string",
          "bank_code": "string"
        },
        "status": "PAID|REFUNDED",
        "type": "ON-ORDER",
        "collected_by": "BAP"
      },
      "created_at": "string (ISO 8601)",
      "updated_at": "string (ISO 8601)"
    }
  }
}
```

### Fulfillment State Summary Table

| `code` | Order Phase | Buyer Message |
|---|---|---|
| `Pending` | Kitchen preparing | "Your order is being prepared" |
| `Packed` | Ready; waiting for agent | "Food is ready, waiting for delivery agent" |
| `Agent-assigned` | Agent found; en route to restaurant | "Delivery agent assigned" |
| `Order-picked-up` | Agent collected food | "Food picked up by delivery agent" |
| `Out-for-delivery` | Agent traveling to buyer | "Out for delivery" |
| `Order-delivered` | Buyer received food | "Delivered! Enjoy your meal" |
| `Cancelled` | Fulfillment cancelled | "Order cancelled — see details" |

### BAP Internal State Machine

| Internal State | Trigger | SSE Event |
|---|---|---|
| `payment_charged` | PG confirmed | `payment_charged` |
| `confirm_sent` | /confirm sent to BPP | `confirm_sent` |
| `confirmed` | /on_confirm received: state=Accepted | `confirmed` |
| `fulfillment_pending` | /on_status: fulfillment code=Pending | `fulfillment_pending` |
| `in_delivery` | /on_status: fulfillment code=Packed or later | `in_delivery` |
| `delivered` | /on_status: fulfillment code=Order-delivered | `delivered` |
| `cancelled` | /on_cancel received | `cancelled` |
