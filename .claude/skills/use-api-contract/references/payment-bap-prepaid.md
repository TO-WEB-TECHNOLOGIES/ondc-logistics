# BAP Prepaid Payment Reference — ONDC F&B (ONDC:RET11)

> **Scope**: This reference covers the complete payment lifecycle for this project's single
> supported payment model:
> - **Collected by**: BAP (Buyer App Platform) — always **mandatory**
> - **Type**: `ON-ORDER` (prepaid) — buyer pays before delivery
> - **Domain**: F&B (ONDC:RET11), Delivery fulfillment
>
> **This project requires BAP to ALWAYS collect payment.** The BAP declares `collected_by: "BAP"`
> in every `/init` request, making payment collection mandatory regardless of what the BPP
> specifies in its `bpp_terms.collect_payment` catalog flag. No COD, no BPP payment collection.
> BAP owns the payment gateway integration end-to-end.
>
> **When to read this file**: Implementing payment gateway integration, building the /confirm
> request, handling payment failures/retries, or answering questions about finder fees,
> paid_amount, or payment status transitions.

---

## Table of Contents

1. [Payment Object in Every API Step](#1-payment-object-in-every-api-step)
2. [Payment Fields in /init](#2-payment-fields-in-init)
3. [Payment Fields in /on_init](#3-payment-fields-in-on_init)
4. [Buyer App Finder Fee](#4-buyer-app-finder-fee)
5. [Quote-to-Payment Validation](#5-quote-to-payment-validation)
6. [BAP Payment Gateway Flow](#6-bap-payment-gateway-flow)
7. [Payment Fields in /confirm](#7-payment-fields-in-confirm)
8. [Complete /confirm Payment Example](#8-complete-confirm-payment-example)
9. [Retry and Idempotency](#9-retry-and-idempotency)
10. [Error Handling — PG Failure Scenarios](#10-error-handling--pg-failure-scenarios)

---

## 1. Payment Object in Every API Step

The payment object evolves across the order flow. Here is how it looks at each stage:

| API Step | `type` | `collected_by` | `status` | `transaction_id` | `paid_amount` |
|---|---|---|---|---|---|
| `/search` | — | — | — | — | — (finder fee in intent.payment) |
| `/select` | `ON-ORDER` | — | — | — | — |
| `/init` | `ON-ORDER` | `BAP` | — | — | — |
| `/on_init` | `ON-ORDER` | `BAP` (confirmed) | — | — | — |
| *[BAP triggers PG]* | — | — | — | — | — |
| `/confirm` | `ON-ORDER` | `BAP` | `PAID` | PG reference | `quote.price.value` from /on_init |
| `/on_confirm` | `ON-ORDER` | `BAP` | `PAID` | (echoed) | (echoed) |

The key invariant: **`paid_amount` in `/confirm` must exactly equal `quote.price.value` from `/on_init`**.

---

## 2. Payment Fields in /init

BAP declares its intent to collect prepaid, with the buyer app finder fee.

```json
{
  "payment": {
    "@ondc/org/buyer_app_finder_fee_type": "percent",
    "@ondc/org/buyer_app_finder_fee_amount": "3",
    "type": "ON-ORDER",
    "collected_by": "BAP"
  }
}
```

### Field reference

| Field | Value | Mandatory | Notes |
|---|---|---|---|
| `@ondc/org/buyer_app_finder_fee_type` | `"percent"` | Yes | Always percent in this project |
| `@ondc/org/buyer_app_finder_fee_amount` | `"3"` | Yes | 3% of order value; string format |
| `type` | `"ON-ORDER"` | Yes | Prepaid — buyer pays before delivery |
| `collected_by` | `"BAP"` | Yes | BAP handles PG; BPP does not collect |

---

## 3. Payment Fields in /on_init

BPP echoes and confirms the payment terms. No payment link (URI) is ever sent in this project.

```json
{
  "payment": {
    "@ondc/org/buyer_app_finder_fee_type": "percent",
    "@ondc/org/buyer_app_finder_fee_amount": "3",
    "type": "ON-ORDER",
    "collected_by": "BAP"
  }
}
```

**What BAP must check**:
- `collected_by == "BAP"` — if BPP ever returns `"BPP"` here, it is unexpected; log and alert
- `type == "ON-ORDER"` — must match what BAP sent in /init
- Finder fee fields are echoed correctly

After validating `/on_init`, BAP reads `quote.price.value` and triggers the payment gateway
for exactly that amount. See §6 for the full PG flow.

---

## 4. Buyer App Finder Fee

### What it is

The buyer app finder fee (`@ondc/org/buyer_app_finder_fee_*`) is the commission the BAP charges
the Seller NP (BPP) for bringing the buyer to their catalog. It is declared by the BAP and
acknowledged by the BPP throughout the transaction.

### Where it appears

| Location | Purpose |
|---|---|
| `/search` → `message.intent.payment` | BAP declares its fee to the network during catalog discovery |
| `/init` → `message.order.payment` | BAP re-declares fee when initiating the order |
| `/on_init` → `message.order.payment` | BPP echoes the fee (confirming acceptance) |
| `/confirm` → `message.order.payment` | BAP echoes the fee one final time in the order record |

### Format

```json
"@ondc/org/buyer_app_finder_fee_type":   "percent",
"@ondc/org/buyer_app_finder_fee_amount": "3"
```

- `type` is always `"percent"` in this project
- `amount` is `"3"` (string) meaning 3% of the order value
- This is a declaration, not a deduction from the buyer's quote; it is settled between BAP and BPP in the payment settlement layer

### Fee amount calculation (for settlement reference)

```
finder_fee = quote.price.value × (finder_fee_amount / 100)
           = 264.00 × (3 / 100)
           = 7.92 INR

BAP receives 7.92 INR from BPP as platform commission (settled separately from buyer payment)
```

The buyer pays `quote.price.value` (e.g., 264.00 INR) in full. The finder fee is not added to
or subtracted from the buyer's bill — it is a BPP-to-BAP settlement.

---

## 5. Quote-to-Payment Validation

Before triggering the payment gateway, BAP must validate that:

### Rule 1 — Always use the /on_init frozen quote

```
CHARGE: on_init.quote.price.value
NOT:    on_select.quote.price.value  ← may be stale (quote is NOT frozen at /on_select)
```

If the quote changed between `/on_select` and `/on_init`, buyer must re-confirm the new
amount before payment is triggered. Do not auto-charge the updated amount.

### Rule 2 — Quote integrity check

```
Σ breakup[].price.value (signed) == quote.price.value

For each breakup entry where @ondc/org/title_type == "item":
  item.price.value × @ondc/org/item_quantity.count == breakup[].price.value
```

If integrity check fails: do NOT trigger payment. Log the discrepancy, alert engineering,
and surface an error to the buyer (do not show BPP's quote).

### Rule 3 — Quote TTL (from /on_select)

The `/on_select` response includes a `quote.ttl`. If the buyer takes too long and the TTL
expires before `/init` completes, BAP must re-call `/select` before proceeding to `/init`.
Once `/on_init` is received, the quote is frozen and has no TTL — BAP may take reasonable
time to collect payment.

### Rule 4 — paid_amount must exactly match

```
/confirm.payment.paid_amount == on_init.quote.price.value
```

A mismatch here causes BPP to reject the `/confirm` — always read the frozen quote value
fresh from the stored `/on_init` response when building the `/confirm` request.

---

## 6. BAP Payment Gateway Flow

The PG is triggered after validating `/on_init` and (if quote changed) receiving buyer
re-confirmation.

```
[on_init received + validated]
│
├─ 1. Read frozen amount from stored on_init.quote.price.value
│
├─ 2. Create PG payment intent
│       amount     = on_init.quote.price.value (in paise for most Indian PGs: × 100)
│       currency   = "INR"
│       order_ref  = BAP internal order ID (mapped to ONDC transaction_id)
│       idempotency_key = BAP order session ID (ensures no double-charge on retry)
│
├─ 3. Present payment UI to buyer
│       (e.g. Razorpay/Cashfree/PayU checkout sheet, UPI deeplink, netbanking redirect)
│
├─ 4a. PG SUCCESS
│       capture PG transaction reference ID (e.g. "pay_PJrvFX2nZ8gQjU")
│       store: pg_transaction_id, payment timestamp, PG status
│       update order session state = "payment_complete"
│       → proceed to send /confirm (§7)
│
├─ 4b. PG FAILURE (card declined, UPI timeout, cancelled by buyer)
│       do NOT re-call /init or /select
│       show error to buyer with retry button
│       on retry → re-present payment UI with SAME amount and SAME idempotency_key
│       → if buyer retries successfully → PG SUCCESS path (§4a)
│       → if buyer abandons → mark session as payment_failed; allow restart from cart
│
└─ 4c. PG TIMEOUT (no response from PG within configured timeout)
        query PG status API to check if payment actually went through
        if PG confirms PAID → treat as 4a (success)
        if PG confirms NOT PAID → treat as 4b (failure)
        if PG status still unknown → wait + retry status check; do not double-charge
```

### What the PG reference ID represents

The `payment.transaction_id` in `/confirm` is the PG's own transaction/payment reference ID
(e.g., Razorpay's `payment_id`, Cashfree's `cf_payment_id`). This is not the ONDC
`context.transaction_id`. They are two different IDs:

| ID | Scope | Example |
|---|---|---|
| `context.transaction_id` | ONDC order session — links /select→/init→/confirm | `"T2"` |
| `payment.transaction_id` (in /confirm) | PG payment reference — proof of collection | `"pay_PJrvFX2nZ8gQjU"` |

---

## 7. Payment Fields in /confirm

The complete payment object to include in `/confirm`:

```
payment (required)
  @ondc/org/buyer_app_finder_fee_type    "percent"
  @ondc/org/buyer_app_finder_fee_amount  "3"
  type                                   "ON-ORDER"
  paid_amount                            string — MUST equal on_init.quote.price.value
  status                                 "PAID"
  transaction_id                         string — PG reference ID (not ONDC transaction_id)
  collected_by                           "BAP"
```

### Field reference

| Field | Value | Mandatory | Notes |
|---|---|---|---|
| `@ondc/org/buyer_app_finder_fee_type` | `"percent"` | Yes | Echo from /init |
| `@ondc/org/buyer_app_finder_fee_amount` | `"3"` | Yes | Echo from /init |
| `type` | `"ON-ORDER"` | Yes | Echo from /init |
| `paid_amount` | string decimal | Yes | Exact value from on_init.quote.price.value (e.g. `"264.00"`) |
| `status` | `"PAID"` | Yes | BAP collected payment successfully via PG |
| `transaction_id` | string | Yes | PG's payment reference ID — proof of collection |
| `collected_by` | `"BAP"` | Yes | Echo from /init |

---

## 8. Complete /confirm Payment Example

Full `/confirm` request showing the payment object in context:

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
    "timestamp": "2023-06-03T08:40:00.000Z",
    "ttl": "PT30S"
  },
  "message": {
    "order": {
      "id": "O1",
      "state": "Created",
      "provider": { "id": "P1", "locations": [{ "id": "L1" }] },
      "items": [
        { "id": "I1", "fulfillment_id": "F1", "location_id": "L1", "quantity": { "count": 1 } }
      ],
      "billing": {
        "name": "Buyer Name",
        "address": {
          "name": "My Apartment", "building": "Tower A",
          "locality": "Koramangala", "city": "Bengaluru",
          "state": "Karnataka", "country": "IND", "area_code": "560034"
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
          "end": {
            "location": {
              "gps": "12.453544,77.928379",
              "address": {
                "name": "My Apartment", "building": "Tower A",
                "locality": "Koramangala", "city": "Bengaluru",
                "state": "Karnataka", "country": "IND", "area_code": "560034"
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
            "@ondc/org/item_id": "I1", "@ondc/org/item_quantity": { "count": 1 },
            "title": "Farm House Pizza", "@ondc/org/title_type": "item",
            "price": { "currency": "INR", "value": "170.00" },
            "item": {
              "quantity": { "available": { "count": "99" }, "maximum": { "count": "99" } },
              "price": { "currency": "INR", "value": "170.00" }
            }
          },
          { "@ondc/org/item_id": "F1", "title": "Delivery charges", "@ondc/org/title_type": "delivery", "price": { "currency": "INR", "value": "50.00" } },
          { "@ondc/org/item_id": "F1", "title": "Packing charges",  "@ondc/org/title_type": "packing",  "price": { "currency": "INR", "value": "25.00" } },
          { "@ondc/org/item_id": "F1", "title": "Convenience fee",  "@ondc/org/title_type": "misc",     "price": { "currency": "INR", "value": "10.00" } },
          { "@ondc/org/item_id": "I1", "title": "Tax",              "@ondc/org/title_type": "tax",      "price": { "currency": "INR", "value": "9.00" } }
        ]
      },
      "payment": {
        "@ondc/org/buyer_app_finder_fee_type": "percent",
        "@ondc/org/buyer_app_finder_fee_amount": "3",
        "type": "ON-ORDER",
        "paid_amount": "264.00",
        "status": "PAID",
        "transaction_id": "pay_PJrvFX2nZ8gQjU",
        "collected_by": "BAP"
      }
    }
  }
}
```

**Key observations**:
- `order.id` = BAP-generated unique order ID (e.g. UUID) — first appears in `/confirm`
- `order.state = "Created"` — always "Created" in /confirm; BPP will set "Accepted" in /on_confirm
- `quote` is echoed in full from `/on_init` — same breakup structure, same values
- `payment.paid_amount = "264.00"` exactly equals `on_init.quote.price.value`
- `payment.transaction_id = "pay_PJrvFX2nZ8gQjU"` is the PG's reference, not the ONDC txn ID

---

## 9. Retry and Idempotency

### Retrying the payment gateway

If the buyer's PG attempt fails and they retry:
- Do **NOT** re-call `/init` — the session is still valid
- Do **NOT** re-call `/select` — the quote is frozen
- Re-present the payment UI with the **same amount** from the stored `/on_init` quote
- Use the **same PG idempotency key** (BAP order session ID) so no double-charge occurs
- Only re-call `/init` if the buyer changes their delivery address

Maximum recommended retries: 3 (after which, surface a "Payment failed" screen and let buyer
restart from cart or contact support).

### Retrying /confirm

If `/confirm` is NACKed by BPP (rare — BPP had a transient error):
- Payment has already been collected → do NOT re-trigger PG
- Retry `/confirm` with the **same** `message_id` (idempotent retry) or a new one
- Store PG `transaction_id` and `paid_amount` so they are consistent across retries
- If BPP continues to NACK, escalate to IGM (Interfacing Grievance Mechanism)

### Order ID uniqueness

`order.id` in `/confirm` is BAP-generated. Generate this once when the buyer confirms the
order and reuse it in all `/confirm` retries. Do not generate a new `order.id` per retry.

---

## 10. Error Handling — PG Failure Scenarios

### Scenario A: Card declined / UPI failed

```
PG response: payment declined
→ do NOT re-call /init
→ show error: "Payment failed. Please try again or use a different payment method."
→ offer retry button (re-presents PG UI, same amount, same idempotency key)
→ offer "Change payment method" (switches PG instrument, same amount)
→ buyer abandoned: mark session payment_failed; order does not proceed
```

### Scenario B: PG timeout (no response)

```
PG request sent; no response within configured timeout (e.g. 30s)
→ query PG status API for this idempotency key
  → PG: PAID → treat as success; proceed to /confirm
  → PG: NOT PAID → treat as failure (Scenario A)
  → PG: UNKNOWN → wait + retry status query (up to 3 times at 10s intervals)
    → still unknown → show "Payment status unclear" to buyer
      → offer buyer to "Check status" (manually re-query PG)
      → do NOT send /confirm until PG confirms PAID
```

### Scenario C: PG success but /confirm NACK from BPP

```
PG: PAID → payment collected
/confirm → BPP returns NACK
→ CRITICAL: payment already collected — do NOT refund automatically
→ log the mismatch: PG txn ID + ONDC transaction ID + NACK error code
→ retry /confirm up to 3 times
→ if still failing:
  → show buyer: "We're confirming your order. You'll receive a confirmation shortly."
  → escalate to IGM with the NACK error + proof of payment (PG reference)
  → if IGM resolution results in order cancellation → initiate refund via PG
```

### Scenario D: Quote amount changed between /on_init and /confirm

```
(Should not happen if implementation is correct, but guard against it)
/confirm.payment.paid_amount != on_init.quote.price.value
→ this means BAP charged buyer a different amount than BPP expects
→ BPP will NACK /confirm
→ Root cause: stale quote used in PG, or bug in amount propagation
→ Fix: always read paid_amount from stored on_init.quote.price.value immediately before sending /confirm
```

---

## Quick Reference — Payment

**The only payment mode for this project**:
```
type:         "ON-ORDER"
collected_by: "BAP"
```

**Amount to charge buyer**: `on_init.quote.price.value` (frozen quote — always this, never /on_select)

**After PG success, send in /confirm**:
```json
{
  "payment": {
    "@ondc/org/buyer_app_finder_fee_type": "percent",
    "@ondc/org/buyer_app_finder_fee_amount": "3",
    "type": "ON-ORDER",
    "paid_amount": "<on_init.quote.price.value>",
    "status": "PAID",
    "transaction_id": "<PG_reference_ID>",
    "collected_by": "BAP"
  }
}
```

**PG failure**: retry PG — do NOT re-call /init or /select

**PG success + /confirm NACK**: do NOT refund — retry /confirm + escalate to IGM if needed

**Finder fee** (3%): echoed in every API step; settled BPP→BAP separately; buyer pays full quote
