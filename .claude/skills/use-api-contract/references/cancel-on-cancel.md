# /cancel + /on_cancel Deep Reference

**Scope**: BAP-collected prepaid (ON-ORDER) only. Delivery fulfillment only.

Read this when implementing or debugging anything related to:
- Sending `/cancel` — buyer-initiated order cancellation
- Processing `/on_cancel` — BPP cancellation acknowledgment (buyer-initiated or BPP/seller-initiated)
- Cancellation reason codes — which ones the BAP can use vs. which are seller-only
- Cancellation fees — how they're calculated based on fulfillment state
- Force cancellation — `force:"yes"` when BPP doesn't respond within TAT
- Unsolicited `/on_cancel` — BPP/seller-initiated cancellation at any time

---

## When to Call `/cancel`

### BAP (Buyer NP) cancellation reason codes

| ID | Meaning | When valid | Cancellation fee |
|----|---------|------------|-----------------|
| `001` | Price change | Always | Per `cancellation_terms` from `/on_init` |
| `002` | Item unavailable | Always | Per `cancellation_terms` |
| `003` | Lower price elsewhere | Always | Per `cancellation_terms` |
| `004` | Pending delivery (buyer asked to wait) | Always | Per `cancellation_terms` |
| `005` | Merchant not accepting orders | Always | Per `cancellation_terms` |
| `006` | **TAT breach** — buyer-initiated after TAT exceeded | Only if TAT is actually breached | **No fee** (buyer-initiated, no penalty) |

**NACK 30012**: If `cancellation_reason_id` is invalid or not applicable, BPP NACKs with `30012`.

**NACK 30014**: If TAT is not actually breached but buyer sends `cancellation_reason_id: "006"`, BPP NACKs with `30014`.

### Cancellation rules by fulfillment state

| Fulfillment state | Can buyer cancel via `/cancel`? | Cancellation fee |
|------------------|--------------------------------|-----------------|
| `Pending` | **Yes** | Per `cancellation_terms` (often 0%) |
| `Packed` | **Yes** | Per `cancellation_terms` (often 10%) |
| `Agent-assigned` | **Yes** | Per `cancellation_terms` |
| `Order-picked-up` | **Yes** | Per `cancellation_terms` (often 10%) |
| `Out-for-delivery` | **NOT allowed** via `/cancel` | NACK `30014` — "cannot cancel at this stage" |
| `Order-delivered` | **NOT allowed** | Already delivered |

### Force cancellation flow

If BPP does not respond to `/cancel` within TAT:
1. Resend `/cancel` with `descriptor.tags[code="params"].list[code="force"]` = `"yes"`
2. If BPP still doesn't respond → issue IGM (Interoperable Governance Message)

---

## /cancel Request Schema

```json
{
  "context": {
    "domain": "ONDC:RET11",
    "action": "cancel",
    "country": "IND",
    "city": "std:080",
    "core_version": "1.2.0",
    "bap_id": "buyerNP.com",
    "bap_uri": "https://buyerNP.com/ondc",
    "bpp_id": "sellerNP.com",
    "bpp_uri": "https://sellerNP.com/ondc",
    "transaction_id": "T2",
    "message_id": "M10",
    "timestamp": "2023-06-03T11:00:00.000Z",
    "ttl": "PT30S"
  },
  "message": {
    "order_id": "O1",
    "cancellation_reason_id": "006",
    "descriptor": {
      "name": "fulfillment",
      "short_desc": "F1",
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

**Field breakdown:**

| Field | Mandatory | Description |
|-------|-----------|-------------|
| `message.order_id` | **Yes** | BAP-generated order UUID from `/confirm` |
| `message.cancellation_reason_id` | **Yes** | BAP reason code (`001`–`006`) |
| `message.descriptor.name` | No | `"fulfillment"` — signals fulfillment-level cancel |
| `message.descriptor.short_desc` | No | Fulfillment ID to cancel (e.g. `"F1"`) |
| `descriptor.tags[].code="params"` | No | Contains `force` and `ttl_response` |
| `params.list[].code="force"` | No | `"yes"` = force cancel (TAT breach flow); `"no"` = normal |
| `params.list[].code="ttl_response"` | No | Max time BPP should respond (e.g. `"PT1H"`) |

**Optional fields in `/cancel`:** All descriptor fields are optional except `order_id` and `cancellation_reason_id`.

---

## /on_cancel Response Schema

```json
{
  "context": { ... },
  "message": {
    "order": {
      "id": "O1",
      "state": "Cancelled",
      "provider": { "id": "P1", "locations": [{ "id": "L1" }] },
      "items": [
        {
          "id": "I1",
          "fulfillment_id": "F1",
          "quantity": { "count": 0 }
        }
      ],
      "billing": { ... },
      "cancellation": {
        "cancelled_by": "buyerNP.com",
        "reason": { "id": "006" }
      },
      "fulfillments": [
        {
          "id": "F1",
          "state": { "descriptor": { "code": "Cancelled" } },
          "type": "Delivery",
          "tracking": true
        }
      ],
      "quote": {
        "price": { "currency": "INR", "value": "0.00" },
        "breakup": [ ... ],
        "ttl": "PT30M"
      }
    }
  }
}
```

**Field breakdown:**

| Field | Mandatory | Description |
|-------|-----------|-------------|
| `order.id` | **Yes** | Same as `order_id` from `/cancel` |
| `order.state` | **Yes** | `"Cancelled"` |
| `order.cancellation.cancelled_by` | **Yes** | `"buyerNP.com"` or `"sellerNP.com"` |
| `order.cancellation.reason.id` | **Yes** | Cancellation reason code used |
| `order.items` | **Yes** | Items with updated quantities (cancelled = `count: 0`) |
| `order.fulfillments` | **Yes** | Fulfillment states set to `"Cancelled"` |
| `order.quote` | **Yes** | Updated quote reflecting refund amount |

**On `cancelled_by`:**
- `"buyerNP.com"` → buyer-initiated via `/cancel`
- `"sellerNP.com"` → seller/BPP-initiated cancellation (unsolicited)

**On `order.items` with quantities:**
- Cancelled items: `quantity.count = 0`
- Non-cancelled items: `quantity.count = original count`
- For partial cancel: only cancelled items have `count: 0`

---

## Cancellation Terms Structure

Stored from `/on_init` — defines fees per fulfillment state:

```json
{
  "cancellation_terms": [
    {
      "fulfillment_state": {
        "descriptor": {
          "code": "Pending",
          "short_desc": "002"
        }
      },
      "cancellation_fee": {
        "percentage": "0.00",
        "amount": { "currency": "INR", "value": "0.00" }
      }
    },
    {
      "fulfillment_state": {
        "descriptor": {
          "code": "Packed",
          "short_desc": "001,003"
        }
      },
      "cancellation_fee": {
        "percentage": "10.00",
        "amount": { "currency": "INR", "value": "195.57" }
      }
    },
    {
      "fulfillment_state": {
        "descriptor": {
          "code": "Order-picked-up",
          "short_desc": "001,003"
        }
      },
      "cancellation_fee": {
        "percentage": "10.00",
        "amount": { "currency": "INR", "value": "195.57" }
      }
    }
  ]
}
```

**`short_desc` in `fulfillment_state.descriptor`** is a comma-separated list of reason codes applicable at that state.

**Fee calculation:** Either `percentage` or `amount` is used — `percentage` takes precedence if both are present.

---

## Unsolicited `/on_cancel` (BPP/Seller-initiated)

BPP can cancel the order **without receiving `/cancel`** from the BAP. This is an unsolicited cancellation.

**Rules:**
- BPP can cancel at any fulfillment state
- `cancellation.cancelled_by` = `"sellerNP.com"`
- Buyer app receives `/on_cancel` as a webhook and must process it
- BAP may NACK with `22502` if the reason code is not a valid seller-cancellable reason

**NACK 22502** (on unsolicited `/on_cancel`): BAP returns this if `cancellation_reason_id` is not one of the seller-cancellable reasons.

> "If cancellation_reason_id is not valid for unsolicited /on_cancel (i.e. not one of the cancellation reasons that can be used by seller NP), buyer app may NACK /on_cancel with error code 22502"

---

## Error Codes

| Code | Scenario | BAP Action |
|------|----------|------------|
| `30012` | `cancellation_reason_id` invalid or not applicable for buyer | Use correct reason code; do not retry |
| `30014` | TAT not breached but buyer sent `cancellation_reason_id: "006"` | Do not cancel on TAT basis; escalate to support |
| `22502` | Seller sent unsolicited `/on_cancel` with invalid reason | NACK with `22502`; log for investigation |
| `31003` | Order processing in progress at SNP (retry window) | Retry after short delay |
| `30018` | Order not found at SNP | Cancel the local order record; do not retry |

---

## Cancellation Decision Tree

```
Is the order in a cancellable state?
  NO (Out-for-delivery / Order-delivered) → Show buyer "Cannot cancel at this stage"
  YES ↓

Is cancellation_reason_id "006" (TAT breach)?
  YES → Verify TAT is actually breached (current time > TAT + buffer)
    YES → Send /cancel with cancellation_reason_id "006" (no fee)
    NO  → BPP will NACK 30014; do not send /cancel
  NO ↓

Send /cancel with appropriate reason code (001-005)
  → Wait for /on_cancel with state "Cancelled"
  → If NACK 30012 → use correct reason code
  → If BPP doesn't respond within TAT → force:"yes" → IGM if still no response
```

---

## Part Cancellation — Item Level vs. Fulfillment Level

**When `Order.state = "Created"`:**
- Part cancellation is at **item level** — buyer can cancel specific items
- Use `/cancel` with specific `fulfillment_id` to target items in that fulfillment

**When `Order.state` is anything else (Accepted, Pending, etc.):**
- Part cancellation is at **fulfillment level** only
- Must cancel entire fulfillment, not individual items within it

**Rule**: Part cancel only possible when `@ondc/org/cancellable = "true"` in the catalog for all items being cancelled.

---

## Settlement Details on Refund

After `/on_cancel` for a prepaid (BAP-collected) order, BAP updates `Order.payment` with a settlement trail:

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

**Refund amount rules:**
- **Pre-shipment cancellation**: full item amount minus logistics costs (at buyer app's discretion)
- **Post-shipment cancellation**: full item amount (logistics already incurred)
- F&B is non-returnable — returns do not apply to food items

---

## Logistics Provider (LSP) Cancellation — RTO Flow

LSP can initiate cancellation independently:

1. LSP sends cancellation request to entity that confirmed logistics (Seller App or Buyer App)
2. LSP includes: cancellation reason code + AWB number + reason description
3. If cancellation triggers RTO:
   - Forward shipment order fulfillment has a corresponding RTO fulfillment entry
   - LSP enters reason code + AWB number
   - RTO fulfillment initiated with `fulfillment.start` and `fulfillment.state` updated
4. If cause is LSP's fault (not buyer or seller):
   - Entity that confirmed logistics searches for replacement LSP with same criteria
   - If no replacement LSP found: retail order is cancelled, buyer gets refund (full amount minus logistics)

---

## Quick Lookup

**BAP cancellation reason IDs**: `001` (price change), `002` (item unavailable), `003` (lower price elsewhere), `004` (pending delivery), `005` (merchant not accepting), `006` (TAT breach — no fee)

**BPP NACK on /cancel**: `30012` (invalid reason), `30014` (TAT not breached for reason 006)

**Force cancel**: send `/cancel` with `force:"yes"` — only for TAT breach escalation

**Unsolicited `/on_cancel`**: BPP can cancel without `/cancel`; BAP may NACK `22502` if reason invalid

**Cancellation fee rule**: `percentage` takes precedence over `amount` if both present in `cancellation_fee`

**Cancellation state machine**: `Pending` → any state until `Out-for-delivery` → NOT cancellable via `/cancel`

**On_cancel `cancelled_by`**: `"buyerNP.com"` = buyer-initiated; `"sellerNP.com"` = BPP-initiated (unsolicited)

**Part cancel rule**: `Order.state = "Created"` → item-level part cancel; any other state → fulfillment-level part cancel only

**Settlement on refund**: BAP adds `settlement_details` with `settlement_counterparty: "buyer"`, `settlement_phase: "refund"` after `/on_cancel`

**LSP cancellation**: LSP can cancel → entity that confirmed logistics finds replacement LSP → if none found, retail order cancelled + refund
