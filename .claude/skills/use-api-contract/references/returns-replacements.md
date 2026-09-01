# Returns & Replacements Deep Reference — ONDC F&B (ONDC:RET11)

**Scope**: BAP-collected prepaid (ON-ORDER) only. Delivery fulfillment only. F&B items are non-returnable by default.

> **When to read this file**: Implementing or debugging buyer-initiated returns or replacements after order delivery. Also covers LSP-initiated cancellation (RTO flow) and settlement trail updates.

---

## Table of Contents

1. [Overview — Returns vs Replacements vs Cancellation](#1-overview--returns-vs-replacements-vs-cancellation)
2. [Returns — Buyer-Initiated Flow](#2-returns--buyer-initiated-flow)
3. [Returns — /update Request Schema](#3-returns--update-request-schema)
4. [Replacements — Buyer-Initiated Flow](#4-replacements--buyer-initiated-flow)
5. [Replacements — /update Request Schema](#5-replacements--update-request-schema)
6. [Seller App Rejection — Policy Error Codes](#6-seller-app-rejection--policy-error-codes)
7. [LSP-Initiated Cancellation — RTO Flow](#7-lsp-initiated-cancellation--rto-flow)
8. [Settlement Trail on Refund](#8-settlement-trail-on-refund)
9. [Quick Lookup](#9-quick-lookup)

---

## 1. Overview — Returns vs Replacements vs Cancellation

| Flow                 | Trigger                                          | API Used               | Reverse Logistics                        |
| -------------------- | ------------------------------------------------ | ---------------------- | ---------------------------------------- |
| **Cancellation**     | Buyer/seller wants to abort order (pre-delivery) | `/cancel`              | No (logistics already in forward path)   |
| **Return**           | Buyer wants to send items back after delivery    | `/update` (item)       | Yes — Reverse QC fulfillment             |
| **Replacement**      | Buyer wants different items instead              | `/update` (item)       | Yes — 2 fulfillments (forward + reverse) |
| **LSP cancellation** | LSP can't deliver → RTO initiated                | LSP → Seller/Buyer App | Yes — RTO fulfillment                    |

**F&B non-returnable**: Food items are typically non-returnable (`@ondc/org/returnable = "false"`). This reference covers catalog items marked as returnable.

**Cancellability criteria**: An order is cancellable only if all items have `@ondc/org/cancellable = "true"` in the catalog. A non-cancellable order will be flagged as such by the seller in `/on_confirm`.

---

## 2. Returns — Buyer-Initiated Flow

```
Buyer selects items to return from order history in Buyer App
    │
    ▼
Buyer uploads images (deficiencies/damages) + reason code + TTLs
    │
    ▼
Buyer App creates /update request (update_target = "item")
    │
    ▼
Buyer App signs + sends /update to Seller App
    │
    ▼
Seller App:
  - Explicitly accepts or rejects within buyer-specified TTL
  - If accepted: initiates reverse QC fulfillment with logistics provider
  - If no response within TTL: return assumed accepted
    │
    ▼
/on_update sent by Seller App with updated order + fulfillment
    │
    ▼
Reverse QC fulfillment: LSP picks up from buyer → delivers to seller
    │
    ▼
/on_status (Return_Picked or Liquidated) → triggers refund initiation
    │
    ▼
Settlement trail updated in Order.payment
```

**Prerequisites for return:**

- Item must be marked as `@ondc/org/returnable = "true"` in catalog
- Buyer must be within the return window (defined by seller policy)
- Buyer must upload images identifying deficiencies/damages
- Buyer must provide a valid reason code

**Buyer app discretion on refund**: For prepaid orders, buyer app may deduct pre-shipment and logistics costs from the refund at its discretion.

---

## 3. Returns — /update Request Schema

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
    "message_id": "M5",
    "city": "std:080",
    "country": "IND",
    "timestamp": "2023-06-03T14:00:00.000Z",
    "ttl": "PT30S"
  },
  "message": {
    "order": {
      "id": "O1-uuid",
      "items": [
        {
          "id": "I1",
          "fulfillment_id": "F1",
          "quantity": { "count": 1 }
        }
      ]
    },
    "update_target": "item"
  }
}
```

**Additional fields for return (beyond basic /update):**

| Field                          | Description                                               |
| ------------------------------ | --------------------------------------------------------- |
| `update_target`                | `"item"` — signals item-level update (return/replacement) |
| `order.items[].id`             | Item ID being returned                                    |
| `order.items[].fulfillment_id` | Fulfillment ID containing the item                        |
| `order.items[].quantity.count` | Quantity being returned                                   |

> **Note**: The ONDC contract for RET11 supports `/update` but this BAP implementation focuses on cancellation flows first. Returns/replacements are lower priority for F&B (food is non-returnable). The schema above shows the target structure.

---

## 4. Replacements — Buyer-Initiated Flow

```
Buyer selects items to replace from order history
    │
    ▼
Buyer App creates /update request (update_target = "item")
    │
    ▼
Buyer App signs + sends /update to Seller App
    │
    ▼
Seller App:
  - If reject: returns policy error code 50002
  - If accept: initiates TWO logistics fulfillments:
      1. Forward: seller → buyer (replacement items)
      2. Reverse: buyer → seller (items being replaced)
    │
    ▼
/on_update sent by Seller App with TWO fulfillments
    │
    ▼
Forward fulfillment: LSP picks up from seller → delivers to buyer
Reverse fulfillment: LSP picks up from buyer → delivers to seller
    │
    ▼
/on_status updates for both fulfillments
```

**Seller App rejection**: If Seller App doesn't accept the replacement request, it returns policy error `50002` (replacement not allowed).

---

## 5. Replacements — /update Request Schema

```json
{
  "context": { ... },
  "message": {
    "order": {
      "id": "O1-uuid",
      "items": [
        {
          "id": "I1",
          "fulfillment_id": "F1",
          "quantity": { "count": 1 }
        }
      ]
    },
    "update_target": "item"
  }
}
```

**Fulfillment structure for replacement (from Seller App /on_update):**

```json
{
  "fulfillments": [
    {
      "id": "F1-replace",
      "type": "Delivery",
      "state": { "descriptor": { "code": "Pending" } },
      "start": {
        "location": { "gps": "...", "address": { ... } },  // seller location
        "contact": { "phone": "...", "email": "..." }
      },
      "end": {
        "location": { "gps": "...", "address": { ... } },   // buyer location
        "contact": { "phone": "...", "email": "..." },
        "instructions": {
          "long_desc": "Deliver replacement items to buyer"
        }
      }
    },
    {
      "id": "F1-return",
      "type": "Reverse QC",
      "state": { "descriptor": { "code": "Pending" } },
      "start": {
        "location": { "gps": "...", "address": { ... } },  // buyer location (pickup)
        "contact": { "phone": "...", "email": "..." },
        "instructions": {
          "long_desc": "Pick up items being replaced from buyer"
        }
      },
      "end": {
        "location": { "gps": "...", "address": { ... } },  // seller location (drop)
        "contact": { "phone": "...", "email": "..." },
        "instructions": {
          "long_desc": "QC check at seller before accepting return"
        }
      }
    }
  ]
}
```

**Reverse QC notes:**

- `Fulfillment.type = "Reverse QC"` — mandatory for the return leg
- `start.location` = buyer address (pickup location)
- `end.location` = seller address (drop location)
- `start.instructions.long_desc` / `end.instructions.long_desc` = logistics agent instructions
- Right to inspect and accept returned items is at seller's discretion (per policy terms in `/on_init`)

---

## 6. Seller App Rejection — Policy Error Codes

If the Seller App does not accept the return/replacement request, it returns a policy error:

| Code    | Type         | Meaning                             | BAP Action                                        |
| ------- | ------------ | ----------------------------------- | ------------------------------------------------- |
| `50001` | POLICY ERROR | Cancellation not accepted by seller | Log; alert buyer; seller has declined cancel      |
| `50002` | POLICY ERROR | Replacement not accepted by seller  | Log; alert buyer; seller has declined replacement |

**NACK response shape:**

```json
{
  "message": { "ack": { "status": "NACK" } },
  "error": {
    "type": "POLICY-ERROR",
    "code": "50002",
    "message": "Replacement not allowed for this item"
  }
}
```

---

## 7. LSP-Initiated Cancellation — RTO Flow

LSP can initiate cancellation (e.g., buyer refused delivery, address not found):

```
LSP sends cancellation request to entity that confirmed logistics:
  - Seller App (if Seller confirmed logistics) — most common for BAP-collected prepaid
  - Buyer App (if Buyer confirmed logistics)
    │
    ▼
LSP includes: cancellation reason code + AWB number + reason
    │
    ▼
If cancellation triggers RTO:
  - Forward shipment has a corresponding RTO fulfillment entry
  - LSP enters reason code + AWB number
  - RTO fulfillment initiated: fulfillment.start and fulfillment.state added
    │
    ▼
/on_status sent by LSP with RTO fulfillment states
    │
    ▼
If cause is LSP's fault:
  - Entity that confirmed logistics searches for replacement LSP
  - Same criteria as original LSP
  - If no replacement found: retail order is CANCELLED
    │
    ▼
Retail order cancelled → buyer refund issued (amount at buyer app discretion)
```

**LSP cancellation reason codes** (from LSP to Seller/Buyer App):

| Code  | Reason                                             |
| ----- | -------------------------------------------------- |
| `016` | Force majeure (accident/strike/law & order)        |
| `018` | Order not serviceable (logistics issue)            |
| `011` | Retail buyer not found / can't be contacted        |
| `013` | Retail buyer can't/doesn't want to accept delivery |
| `014` | Delivery address incorrect or not found            |

---

## 8. Settlement Trail on Refund

After `/on_cancel` (cancellation) or `/on_status` with `Return_Picked` (return), BAP updates `Order.payment` with settlement details:

```json
{
  "payment": {
    "@ondc/org/settlement_details": [
      {
        "settlement_counterparty": "buyer",
        "settlement_phase": "refund",
        "settlement_status": "forward-settled",
        "settlement_type": "neft",
        "settlement_amount": "250.00",
        "settlement_date": "2023-06-03T12:00:00.000Z"
      }
    ]
  }
}
```

**Settlement field definitions:**

| Field                     | Value                                              |
| ------------------------- | -------------------------------------------------- |
| `settlement_counterparty` | `"buyer"` — refund goes to buyer                   |
| `settlement_phase`        | `"refund"` — phase is refund                       |
| `settlement_status`       | `"forward-settled"` — settled in forward direction |
| `settlement_type`         | `"neft"` / `"rtgs"` / `"upi"` — payment method     |
| `settlement_amount`       | Amount being refunded                              |
| `settlement_date`         | ISO8601 timestamp of settlement                    |

**Refund amount rules:**

- **Pre-shipment cancellation**: full item amount minus logistics costs (buyer app discretion)
- **Post-shipment cancellation**: full item amount (logistics already incurred)
- **Returns**: item price minus reverse logistics cost (buyer app discretion)
- **LSP fault cancellation**: buyer gets full refund (including forward logistics)

---

## 9. Quick Lookup

**Returns**: buyer initiates via `/update` (update_target = "item") → images + reason + TTL → Seller accepts or implicitly accepts → reverse QC fulfillment → refund via settlement trail

**Replacements**: buyer initiates via `/update` → Seller responds with TWO fulfillments (forward Delivery + reverse QC) → both fulfilled → no refund (replacement)

**Policy rejection codes**: `50001` = cancellation rejected, `50002` = replacement rejected

**LSP cancellation**: LSP → entity that confirmed logistics → replacement LSP found or retail order cancelled → refund

**Settlement on refund**: `settlement_counterparty: "buyer"`, `settlement_phase: "refund"`, `settlement_status: "forward-settled"`

**F&B is non-returnable**: food items typically `@ondc/org/returnable = "false"` — returns apply only to items explicitly marked returnable

**Part cancel (Order.state = "Created")**: item-level part cancel via `/cancel`

**Part cancel (Order.state ≠ "Created")**: fulfillment-level part cancel only
