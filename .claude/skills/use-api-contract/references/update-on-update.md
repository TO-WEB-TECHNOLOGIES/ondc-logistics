# /update + /on_update Deep Reference — ONDC F&B (ONDC:RET11)

> **Scope**: BAP-collected prepaid (ON-ORDER) only. Delivery fulfillment only.
>
> **When to read this file**: Implementing or debugging any `/update` or `/on_update`
> flow — buyer-initiated returns, merchant/seller-initiated part cancellations,
> settlement trail updates, fulfillment state changes, LSP updates, or any
> order amendment after `/confirm`.

---

## Table of Contents

1. [Overview — What /update and /on_update Are For](#1-overview--what-update-and-on_update-are-for)
2. [update_target Reference — What Each Target Means](#2-update_target-reference--what-each-target-means)
3. [/update Request Schema — All Targets](#3-update-request-schema--all-targets)
4. [/on_update Response Schema](#4-on_update-response-schema)
5. [Return Flow — Buyer-Initiated (update_target: "item")](#5-return-flow--buyer-initiated-update_target-item)
6. [Return Flow — Step-by-Step States](#6-return-flow--step-by-step-states)
7. [Merchant/Seller Part Cancellation (unsolicited /on_update)](#7-merchantseller-part-cancellation-unsolicited-on_update)
8. [Settlement Trail Update (update_target: "payment")](#8-settlement-trail-update-update_target-payment)
9. [Fulfillment Update (update_target: "fulfillment") — LSP/Buyer-Delivery](#9-fulfillment-update-update_target-fulfillment--lspbuyer-delivery)
10. [Part Cancellation Rules](#10-part-cancellation-rules)
11. [Error Codes](#11-error-codes)
12. [Rules Summary](#12-rules-summary)
13. [Quick Lookup](#13-quick-lookup)

---

## 1. Overview — What /update and /on_update Are For

`/update` and `/on_update` handle **any order amendment after `/confirm`**
that is **not a full cancellation** (`/cancel`) and **not a state update**
(`/on_status`). This includes:

| Flow | Who Initiates | update_target |
|------|--------------|---------------|
| Part return request | **BAP** (buyer) | `"item"` |
| Return approval (seller wants item back) | **BPP** | `"item"` (via `/on_update`) |
| Return approval (seller doesn't want item back) | **BPP** | `"item"` (via `/on_update`) |
| Return rejected | **BPP** | `"item"` (via `/on_update`) |
| Return picked | **BPP/LSP** | `"item"` (via `/on_update`) |
| Return pick failed + rescheduled | **BPP/LSP** | `"item"` (via `/on_update`) |
| Return delivered | **BPP/LSP** | `"item"` (via `/on_update`) |
| Merchant part cancellation | **BPP** (unsolicited) | `"item"` (via `/on_update`) |
| Settlement trail update (refund initiated) | **BAP** | `"payment"` |
| Fulfillment state update (Buyer-Delivery LSP) | **BAP or BPP** | `"fulfillment"` |
| Agent details update | **BAP/BPP** | `"fulfillment"` |

**Key invariant**: `quote.price.value` **cannot increase** via `/on_update`.
If the order value decreases, it must be due to a decrease in item quantity
(`@ondc/org/item_quantity.count`) for `title_type: "item"` entries only.

**`/on_update` is always solicited** for BAP-initiated updates (in response to
`/update`). However, **BPP can send `/on_update` unsolicited** for
merchant/seller-initiated part cancellations or return status updates.

---

## 2. update_target Reference — What Each Target Means

### `"item"` — Item-Level Amendment (Returns + Part Cancellations)

Used when changing **which items are in the order**:
- Buyer initiates a **return request** for specific items
- BPP responds with **approval/rejection/interim status** for the return
- BPP sends **return pickup/delivery** updates
- BPP **partially cancels** items (merchant-initiated, unsolicited)

`update_target: "item"` is the **only target for returns**. For F&B
(customized items), the base item + all its customizations must be cancelled
together in the same proportion.

### `"payment"` — Settlement Trail Update

Used to communicate **settlement details for a refund**:
- Settlement phase: `"refund"` (buyer gets money back)
- Settlement counterparty: `"buyer"` (refund goes to buyer)
- Settlement type: `"upi"`, `"neft"`, `"rtgs"`, etc.
- Settlement amount: amount being refunded
- Settlement timestamp: when settlement was initiated

### `"fulfillment"` — Fulfillment State Update

Used for **Buyer-Delivery** logistics (LSP managed by buyer NP) or any
fulfillment-level state change:
- LSP picks up the order (state change to `Order-picked-up`)
- LSP delivery delay
- Fulfillment cancellation via `/update` (not `/cancel`)
- Agent details update (name, phone, vehicle)
- Shipping label update
- Reverse QC output update

### `"order"` — Order-Level Amendment

Used to update **non-item, non-payment, non-fulfillment** aspects of the order:
- Delivery time slot change (not common for F&B)

---

## 3. /update Request Schema — All Targets

### 3a. /update — Buyer Initiates Part Return (update_target: "item")

```json
{
  "context": {
    "domain": "ONDC:RET11",
    "action": "update",
    "core_version": "1.2.0",
    "bap_id": "buyerNP.com",
    "bap_uri": "https://buyerNP.com/ondc",
    "bpp_id": "sellerNP.com",
    "bpp_uri": "https://sellerNP.com/ondc",
    "transaction_id": "T2",
    "message_id": "M6",
    "city": "std:080",
    "country": "IND",
    "timestamp": "2023-06-03T13:00:00.000Z",
    "ttl": "PT30S"
  },
  "message": {
    "update_target": "item",
    "order": {
      "id": "O1-uuid",
      "items": [
        {
          "id": "I1",
          "fulfillment_id": "F1",
          "quantity": { "count": 1 }
        }
      ]
    }
  }
}
```

**Key fields:**
- `update_target: "item"` — signals item-level update
- `order.items[].id` — catalog item ID being returned
- `order.items[].fulfillment_id` — fulfillment containing the item
- `order.items[].quantity.count` — quantity being returned (partial or full)

---

### 3b. /update — Settlement Trail for Refund (update_target: "payment")

```json
{
  "context": { ... },
  "message": {
    "update_target": "payment",
    "order": {
      "id": "O1-uuid",
      "fulfillments": [
        {
          "id": "R1",
          "type": "Return"
        }
      ],
      "payment": {
        "@ondc/org/settlement_details": [
          {
            "settlement_counterparty": "buyer",
            "settlement_phase": "refund",
            "settlement_type": "upi",
            "settlement_amount": "170.00",
            "settlement_timestamp": "2023-06-03T13:30:00.000Z"
          }
        ]
      }
    }
  }
}
```

---

### 3c. /update — Fulfillment State Update (update_target: "fulfillment")

Common fulfillment tags used in `fulfillments[].tags`:

**`update_state`** — change fulfillment state:

```json
{
  "code": "update_state",
  "list": [
    { "code": "state", "value": "Order-picked-up" },
    { "code": "reason_id", "value": "007" }
  ]
}
```

**`cancel_request`** — LSP-initiated cancellation request:

```json
{
  "code": "cancel_request",
  "list": [
    { "code": "retry_count", "value": "3" },
    { "code": "reason_id", "value": "013" },
    { "code": "initiated_by", "value": "lsp.com" }
  ]
}
```

**`update_fulfillment_time`** — update pickup/delivery time:

```json
{
  "code": "update_fulfillment_time",
  "list": [
    { "code": "state", "value": "Order-picked-up" },
    { "code": "timestamp", "value": "2023-11-17T09:30:00.000Z" },
    { "code": "start_time", "value": "2023-11-17T09:00:00.000Z" },
    { "code": "end_time", "value": "2023-11-17T09:30:00.000Z" }
  ]
}
```

**`fulfillment_delay`** — delay in fulfillment:

```json
{
  "code": "fulfillment_delay",
  "list": [
    { "code": "state", "value": "Order-picked-up" },
    { "code": "reason_id", "value": "002" },
    { "code": "timestamp", "value": "2023-11-16T22:00:00.000Z" }
  ]
}
```

**`update_agent_details`** — update delivery agent info:

```json
{
  "code": "update_agent_details",
  "list": [
    { "code": "name", "value": "agent_name" },
    { "code": "phone", "value": "9886098860" }
  ]
}
```

**`update_label`** — shipping label for P2H2P (pickup-to-hub-to-door):

```json
{
  "code": "update_label",
  "list": [
    { "code": "shipping", "value": "link to downloadable shipping label" }
  ]
}
```

**`reverseqc_output`** — Reverse QC result for returns:

```json
{
  "code": "reverseqc_output",
  "list": [
    { "code": "P001", "value": "Atta" },
    { "code": "P003", "value": "1" },
    { "code": "Q001", "value": "Y" }
  ]
}
```

Full fulfillment update example:

```json
{
  "context": { ... },
  "message": {
    "update_target": "fulfillment",
    "order": {
      "id": "O1-uuid",
      "fulfillments": [
        {
          "id": "F3",
          "tags": [
            {
              "code": "update_state",
              "list": [
                { "code": "state", "value": "Order-picked-up" },
                { "code": "reason_id", "value": "007" }
              ]
            }
          ]
        }
      ]
    }
  }
}
```

---

## 4. /on_update Response Schema

`/on_update` mirrors the order structure with any changes applied.
It returns the **same information as `/on_status`**:
- Audit trail of items (returns, cancels processed or in-progress)
- Current state of order items + fulfillment
- Order quote and breakup (updated to reflect change)
- Settlement trail (if available)

```json
{
  "context": { ... },
  "message": {
    "order": {
      "id": "O1-uuid",
      "state": "In-progress",        // or "Completed", "Cancelled"
      "provider": { ... },
      "items": [...],              // items with updated quantities
      "fulfillments": [...],       // fulfillments with updated state
      "quote": {
        "price": { "currency": "INR", "value": "0.00" },  // updated
        "breakup": [...]
      },
      "payment": { ... }          // settlement trail if applicable
    }
  }
}
```

**`/on_update` state values** (for `order.state`):

| Value | When |
|-------|------|
| `"In-progress"` | Order active — return/partial cancel in progress |
| `"Completed"` | All fulfillments delivered; no further updates except returns |
| `"Cancelled"` | Order fully cancelled |

---

## 5. Return Flow — Buyer-Initiated (update_target: "item")

```
Buyer opens return request in app
    │
    ▼
POST /api/v1/update
{
  "update_target": "item",
  "order": {
    "id": "ord_abc123",
    "items": [{ "id": "I1", "fulfillment_id": "F1", "quantity": { "count": 1 } }]
  }
}
    │
    ▼
BPP /on_update — Interim (seller NP sends interim status)
    │
    ▼
BPP /on_update — Approval with return (seller wants item back)
    │
    ▼
BPP /on_update — Return Picked
    │
    ▼
BPP /on_update — Return Delivered / Liquidated
    │
    ▼
BAP /update — Settlement trail (settlement_phase: "refund")
    │
    ▼
BPP /on_update — Settlement confirmation (optional)
```

---

## 6. Return Flow — Step-by-Step States

### Step 1: Buyer Initiates Return (BAP → `/update`)

```json
{
  "message": {
    "update_target": "item",
    "order": {
      "id": "ord_abc123",
      "items": [
        {
          "id": "I1",
          "fulfillment_id": "F1",
          "quantity": { "count": 1 }
        }
      ]
    }
  }
}
```

### Step 2: Seller Sends Interim Status (BPP → `/on_update`)

```json
{
  "message": {
    "order": {
      "id": "ord_abc123",
      "state": "In-progress",
      "items": [
        {
          "id": "I1",
          "fulfillment_id": "F1",
          "quantity": { "count": 1 }
        }
      ],
      "fulfillments": [
        {
          "id": "F1",
          "type": "Delivery",
          "state": { "descriptor": { "code": "Pending" } }
        }
      ],
      "quote": { ... }
    }
  }
}
```

### Step 3a: Seller Approves — Wants Item Back (BPP → `/on_update`)

```json
{
  "message": {
    "order": {
      "id": "ord_abc123",
      "state": "In-progress",
      "items": [
        {
          "id": "I1",
          "fulfillment_id": "F1",
          "quantity": { "count": 1 },
          "tags": [
            {
              "code": "return_request",
              "list": [
                { "code": "id", "value": "R1" },
                { "code": "ttl", "value": "PT24H" },
                { "code": "reason_id", "value": "001" }
              ]
            }
          ]
        }
      ],
      "fulfillments": [
        {
          "id": "F1",
          "type": "Delivery",
          "state": { "descriptor": { "code": "Pending" } },
          // Return fulfillment created
          "@ondc/org/linked_orders": [
            {
              "id": "R1",
              "state": { "descriptor": { "code": "Return_Picked" } },
              "fulfillment_id": "R1"
            }
          ]
        }
      ]
    }
  }
}
```

### Step 3b: Seller Approves — Doesn't Want Item Back (BPP → `/on_update`)

Same as Step 3a, but the quote is updated to show item price = 0 (full refund),
and the BPP may skip creating a Return fulfillment.

### Step 4: Return Picked (BPP → `/on_update`)

```json
{
  "message": {
    "order": {
      "id": "ord_abc123",
      "state": "In-progress",
      "items": [
        {
          "id": "I1",
          "fulfillment_id": "F1",
          "quantity": { "count": 0 }  // refunded
        }
      ],
      "fulfillments": [
        {
          "id": "F1",
          "type": "Delivery",
          "state": { "descriptor": { "code": "Cancelled" } }
        },
        {
          "id": "R1",
          "type": "Reverse QC",
          "state": { "descriptor": { "code": "Return_Picked" } }
        }
      ],
      "quote": {
        "price": { "currency": "INR", "value": "0.00" },
        "breakup": [
          {
            "@ondc/org/item_id": "I1",
            "title": "Farm House Pizza",
            "@ondc/org/title_type": "item",
            "price": { "currency": "INR", "value": "0.00" }
          }
        ]
      }
    }
  }
}
```

### Step 5: Return Delivered / Liquidated (BPP → `/on_update`)

```json
{
  "message": {
    "order": {
      "id": "ord_abc123",
      "state": "Completed",
      "fulfillments": [
        {
          "id": "F1",
          "type": "Delivery",
          "state": { "descriptor": { "code": "Cancelled" } }
        },
        {
          "id": "R1",
          "type": "Reverse QC",
          "state": { "descriptor": { "code": "Liquidated" } }
        }
      ],
      "quote": {
        "price": { "currency": "INR", "value": "0.00" }
      }
    }
  }
}
```

### Step 6: BAP Sends Settlement Trail (BAP → `/update`)

```json
{
  "message": {
    "update_target": "payment",
    "order": {
      "id": "ord_abc123",
      "fulfillments": [
        { "id": "R1", "type": "Return" }
      ],
      "payment": {
        "@ondc/org/settlement_details": [
          {
            "settlement_counterparty": "buyer",
            "settlement_phase": "refund",
            "settlement_type": "upi",
            "settlement_amount": "170.00",
            "settlement_timestamp": "2023-06-03T13:30:00.000Z"
          }
        ]
      }
    }
  }
}
```

---

## 7. Merchant/Seller Part Cancellation (unsolicited /on_update)

BPP can send `/on_update` to part-cancel items **without a prior `/update`**
from BAP. This is a **seller-initiated part cancellation**.

**Rules:**
- Only valid when fulfillment state is `"Pending"` or `"Packed"`
- A separate cancellation fulfillment is created for the cancelled items
- Quote is updated to reflect the cancellation fee
- `order.state` in `/on_update` = `"Accepted"` (not `"Cancelled"` — order still active)
- BAP may NACK with `22508` if dynamic item cancel proportions are not followed

### Merchant Cancels a Customized Item

```json
{
  "context": { ... },
  "message": {
    "order": {
      "id": "O1-uuid",
      "state": "Accepted",
      "items": [
        {
          "id": "I1",
          "fulfillment_id": "C1",
          "quantity": { "count": 1 },
          "parent_item_id": "DI1",
          "tags": [{ "code": "type", "list": [{ "code": "type", "value": "item" }] }]
        },
        {
          "id": "C1",
          "fulfillment_id": "C1",
          "quantity": { "count": 1 },
          "parent_item_id": "DI1",
          "tags": [{ "code": "type", "list": [{ "code": "type", "value": "customization" }] }]
        }
      ],
      "fulfillments": [
        {
          "id": "C1",
          "type": "Delivery",
          "state": { "descriptor": { "code": "Cancelled" } }
        }
      ],
      "quote": {
        "price": { "currency": "INR", "value": "0.00" },
        "breakup": [
          {
            "@ondc/org/item_id": "I1",
            "title": "Farm House Pizza",
            "@ondc/org/title_type": "item",
            "price": { "currency": "INR", "value": "0.00" }
          },
          {
            "@ondc/org/item_id": "C1",
            "title": "Extra Cheese",
            "@ondc/org/title_type": "item",
            "price": { "currency": "INR", "value": "0.00" }
          },
          {
            "@ondc/org/item_id": "F1",
            "title": "Cancellation Fee",
            "@ondc/org/title_type": "misc",
            "price": { "currency": "INR", "value": "50.00" }
          }
        ]
      }
    }
  }
}
```

### Merchant Cancels a Non-Customized Item

```json
{
  "context": { ... },
  "message": {
    "order": {
      "id": "O1-uuid",
      "state": "Accepted",
      "items": [
        {
          "id": "I1",
          "fulfillment_id": "F1",
          "quantity": { "count": 0 }  // cancelled
        }
      ],
      "fulfillments": [
        {
          "id": "F1",
          "type": "Delivery",
          "state": { "descriptor": { "code": "Cancelled" } }
        }
      ],
      "quote": {
        "price": { "currency": "INR", "value": "50.00" },
        "breakup": [
          {
            "@ondc/org/item_id": "I1",
            "title": "Farm House Pizza",
            "@ondc/org/title_type": "item",
            "price": { "currency": "INR", "value": "0.00" }
          },
          {
            "@ondc/org/item_id": "F1",
            "title": "Cancellation Fee",
            "@ondc/org/title_type": "misc",
            "price": { "currency": "INR", "value": "50.00" }
          }
        ]
      }
    }
  }
}
```

---

## 8. Settlement Trail Update (update_target: "payment")

Settlement trail is sent via `/update` to communicate the **refund has been
initiated** after a return or cancellation.

```json
{
  "message": {
    "update_target": "payment",
    "order": {
      "id": "ord_abc123",
      "fulfillments": [
        { "id": "R1", "type": "Return" }
      ],
      "payment": {
        "@ondc/org/settlement_details": [
          {
            "settlement_counterparty": "buyer",
            "settlement_phase": "refund",
            "settlement_type": "upi",
            "settlement_amount": "170.00",
            "settlement_timestamp": "2023-06-03T13:30:00.000Z"
          }
        ]
      }
    }
  }
}
```

**Settlement field definitions:**

| Field | Value |
|-------|-------|
| `settlement_counterparty` | `"buyer"` — refund goes to buyer |
| `settlement_phase` | `"refund"` — phase is refund |
| `settlement_type` | `"upi"`, `"neft"`, `"rtgs"`, etc. |
| `settlement_amount` | Amount being refunded |
| `settlement_timestamp` | ISO8601 timestamp |

---

## 9. Fulfillment Update (update_target: "fulfillment") — LSP/Buyer-Delivery

Applicable for **Buyer-Delivery** fulfillment type (LSP managed by buyer NP).
Can also be used for cancelling individual fulfillments.

**Rules:**
- Request for update can be sent for 1 or more existing fulfillments
  that **have not reached terminal state**
- `/on_update` response is **solicited** (in response to `/update`)

### Fulfillment State Update Example

```json
{
  "message": {
    "update_target": "fulfillment",
    "order": {
      "id": "ord_abc123",
      "fulfillments": [
        {
          "id": "F3",
          "tags": [
            {
              "code": "update_state",
              "list": [
                { "code": "state", "value": "Order-picked-up" },
                { "code": "reason_id", "value": "007" }
              ]
            }
          ]
        }
      ]
    }
  }
}
```

### LSP Cancellation Request Example

```json
{
  "message": {
    "update_target": "fulfillment",
    "order": {
      "id": "ord_abc123",
      "fulfillments": [
        {
          "id": "F3",
          "tags": [
            {
              "code": "cancel_request",
              "list": [
                { "code": "retry_count", "value": "3" },
                { "code": "reason_id", "value": "013" },
                { "code": "initiated_by", "value": "lsp.com" }
              ]
            }
          ]
        }
      ]
    }
  }
}
```

### Agent Details Update Example

```json
{
  "message": {
    "update_target": "fulfillment",
    "order": {
      "id": "ord_abc123",
      "fulfillments": [
        {
          "id": "F3",
          "tags": [
            {
              "code": "update_agent_details",
              "list": [
                { "code": "name", "value": "Rajesh" },
                { "code": "phone", "value": "9886098860" }
              ]
            }
          ]
        }
      ]
    }
  }
}
```

---

## 10. Part Cancellation Rules

### For Returns (BAP-Initiated via `/update` with `update_target: "item"`)

1. **Item must be returnable** — `@ondc/org/returnable = "true"` in catalog
2. **Return window** — buyer must initiate within the seller's return window
3. **Response must have exactly the same number of items** as requested
4. **Order value cannot increase** via `/on_update`
5. **Quote trail is immutable** after added at refund trigger point
6. **F&B is non-returnable by default** — most food items have `@ondc/org/returnable = "false"`

### For Merchant Part Cancellation (BPP-Initiated via unsolicited `/on_update`)

1. **Can only cancel if fulfillment state is `"Pending"`**
2. **A separate cancellation fulfillment is created** with cancellation reason code
3. **Updated quote** is provided at the refund trigger point (`"Liquidated"`, `"Return_Picked"`, `"Cancelled"`)
4. **For customized items**: base item + customizations must be cancelled in the same proportion — if not, BAP NACKs with `22508`

### Dynamic Item Part Cancel Rule

If a base item has customizations and the merchant cancels it:

```
Base item DI1 (qty 1) + Customization C1 (qty 1) + Customization C7 (qty 1)
    ↓ merchant cancels qty 1 of DI1
ALL of DI1 + C1 + C7 must be cancelled together (qty 1 each)
```

BAP must verify: for every dynamic item cancelled, the sum of quantities
of all its components (base + customizations) must be zero. If not,
NACK with error code `22508`.

---

## 11. Error Codes

### Errors in /on_update (BPP → BAP)

| Code | Type | Meaning | BAP Action |
|------|------|---------|------------|
| `22508` | DOMAIN-ERROR | Dynamic item cancel proportions not followed | NACK; investigate |
| `20000` | DOMAIN-ERROR | Invalid context | NACK |
| `22502` | DOMAIN-ERROR | Invalid cancellation reason in unsolicited on_update | NACK with `22502` |
| `30018` | ORDER-NOT-FOUND | Order not found at SNP | Do not retry |
| `31003` | ORDER-PROCESSING-IN-PROGRESS | Order in retry window | Wait; retry window |
| `20002` | DOMAIN-ERROR | Stale timestamp for same transaction | NACK |

### NACK Response Shape

```json
{
  "message": { "ack": { "status": "NACK" } },
  "error": {
    "type": "DOMAIN-ERROR",
    "code": "22508",
    "message": "Dynamic item cancel proportions not followed"
  }
}
```

---

## 12. Rules Summary

**Order value**: `quote.price.value` cannot increase via `/on_update`. Decrease only.

**Quote trail**: Immutable after being added at the refund trigger point.

**Return response**: Must have exactly the same number of items as the return request.

**Dynamic items**: Base + customizations must be cancelled in equal proportion. If not, BAP NACKs `22508`.

**Fulfillment update**: Can only target fulfillments that have NOT reached terminal state.

**Unsolicited `/on_update`**: BPP can send `/on_update` without a prior `/update` for merchant-initiated part cancellation. BAP handles it like any other `/on_update`.

**Status changes**: Whenever there is a status change, an **unsolicited `/on_status`** call should also be made by BPP (not just `/on_update`).

**Batching**: Order updates and status changes should NOT be batched — send immediately.

---

## 13. Quick Lookup

**`/update` targets**: `"item"` (returns/part cancel), `"payment"` (settlement trail), `"fulfillment"` (LSP/Buyer-Delivery state), `"order"` (order-level)

**Return flow**: BAP `/update` (item) → BPP `/on_update` (interim) → BPP `/on_update` (approval) → BPP `/on_update` (picked) → BPP `/on_update` (delivered/liquidated) → BAP `/update` (settlement trail)

**Dynamic item cancel**: NACK `22508` if base item + customizations not cancelled in same proportion

**Order value rule**: Cannot increase via `/on_update`. Decrease only due to quantity reduction.

**Merchant/seller part cancel**: Unsolicited `/on_update` from BPP; only valid when fulfillment state is `Pending`

**Settlement trail**: `settlement_counterparty: "buyer"`, `settlement_phase: "refund"`, `settlement_type: "upi"`

**Fulfillment update tags**: `update_state`, `cancel_request`, `update_fulfillment_time`, `fulfillment_delay`, `update_agent_details`, `update_label`, `reverseqc_output`
