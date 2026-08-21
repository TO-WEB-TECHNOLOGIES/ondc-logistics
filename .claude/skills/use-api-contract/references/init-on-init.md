# /init + /on_init Deep Reference — ONDC F&B (ONDC:RET11)

> **Scope**: This reference is specific to this project's constraints:
>
> - **Fulfillment type**: `Delivery` only
> - **Payment**: BAP-collected prepaid (`type: "ON-ORDER"`, `collected_by: "BAP"`) only
> - No COD, no BPP payment collection, no Self-Pickup, no Buyer-Delivery
>
> **When to read this file**: Implementing or debugging `/init` (sending buyer address + payment
> preference) or `/on_init` (receiving frozen quote + cancellation terms). For full payment gateway
> implementation details, see `payment-bap-prepaid.md`.

---

## Table of Contents

1. [Overview — Init Flow](#1-overview--init-flow)
2. [When to Call /init vs Re-call /select](#2-when-to-call-init-vs-re-call-select)
3. [/init Request — Payload Schema](#3-init-request--payload-schema)
4. [/init Scenarios](#4-init-scenarios)
   - 4.1 Delivery — BAP Prepaid (plain items)
   - 4.2 F&B Customized Items, Delivery, Prepaid
   - 4.3 Slotted Delivery (buyer selects time window)
5. [/on_init Response — Payload Schema](#5-on_init-response--payload-schema)
6. [/on_init Scenarios](#6-on_init-scenarios)
   - 6.1 BAP Collects Prepaid — Standard Response
   - 6.2 Quote Changed from /on_select
   - 6.3 F&B Customized Items — Full /on_init
7. [Cancellation Terms — Format and Rules](#7-cancellation-terms--format-and-rules)
8. [Enum Reference Tables](#8-enum-reference-tables)
9. [Error Codes](#9-error-codes)
10. [Cancellation Reason Codes (Retail — Current)](#10-cancellation-reason-codes-retail--current)
11. [BAP Processing Algorithm for /on_init](#11-bap-processing-algorithm-for-on_init)

---

## 1. Overview — Init Flow

```
BAP → BPP : /init    (billing address + delivery address + payment = ON-ORDER, collected_by = BAP)
BPP → BAP : /on_init (frozen quote + cancellation terms)
BAP → PG  :          (trigger payment gateway with frozen quote.price.value)
BAP → BPP : /confirm (payment.status = "PAID" + payment.transaction_id = PG reference)
```

**Position in order lifecycle**: `/init` comes after `/on_select` has been validated (quote is
provisional). The quote only becomes frozen — guaranteed — after a successful `/on_init`. BAP triggers
its payment gateway only after receiving and validating `/on_init`, using the frozen quote amount.

**Key rules**:

- BAP must call `/select` again (not just `/init`) if the cart changes after `/on_select`
- BAP must call `/init` again if the delivery address changes
- Quote from `/on_init` may differ from `/on_select` — BAP must validate and show diff to buyer
- `transaction_id` is the same across `/select` → `/init` → `/confirm` for one order session
- `/init` context `action` = `"init"`, TTL = `"PT30S"`
- `/on_init` echoes the same `transaction_id` and `message_id` from `/init`
- BPP sends ACK synchronously; `/on_init` arrives asynchronously via BAP webhook

---

## 2. When to Call /init vs Re-call /select

### Proceed to /init when:

- `/on_select` fulfillment `state.descriptor.code == "Serviceable"`
- Quote TTL has not expired
- No out-of-stock items (or buyer has accepted reduced quantity)
- Minimum order value is met (no error 30023)
- Buyer has entered billing + delivery address

### Re-call /select (do NOT go to /init) when:

- Buyer changes cart (adds/removes items or changes quantities)
- Buyer changes delivery address (new gps/area_code → different serviceability/quote)
- Quote TTL has expired before buyer reaches /init
- BPP returned a different `provider.locations[0].id` in /on_select and buyer hasn't acknowledged

### Re-call /init when:

- Buyer changes delivery address but NOT cart (same cart, new address)
- Buyer changes chosen delivery time slot
- `/on_init` returns a quote that differs from `/on_select` and buyer re-confirms

### Abort order session when:

- All fulfillments are `Non-serviceable` in `/on_select`
- Payment gateway fails after multiple retries (show failure; do not re-call /init)

---

## 3. /init Request — Payload Schema

```
context (required)
  domain            "ONDC:RET11"
  action            "init"
  core_version      "1.2.0"
  bap_id            string — BAP subscriber ID
  bap_uri           string — BAP callback URL
  bpp_id            string — BPP subscriber ID (from /on_select context)
  bpp_uri           string — BPP endpoint URL (from /on_select context)
  transaction_id    string — SAME as /select for this order session
  message_id        string — unique per API call (new UUID, different from /select)
  city              string — "std:080" format (same city as /select)
  country           "IND"
  timestamp         ISO8601 UTC
  ttl               "PT30S"

message.order (required)

  provider (required)
    id              string — same provider ID from /select + /on_select
    locations[]     (required)
      id            string — provider location ID
                            (use updated ID if BPP returned a different one in /on_select)

  items[] (required — mirrors /select items exactly, with fulfillment_id added)
    id              string — catalog item/customization ID
    parent_item_id  string? — dynamic group ID DI1, DI2… (REQUIRED for F&B customized items)
    fulfillment_id  string  — REQUIRED: ID of the chosen Delivery fulfillment from /on_select
    location_id     string — provider location ID
    quantity
      count         integer — ordered quantity
    tags[]          (same type+parent tags as /select — REQUIRED for F&B customized items)
      { code:"type",   list:[{code:"type",   value:"item"|"customization"}] }
      { code:"parent", list:[{code:"id",     value:"<CG_ID>"}] }
        — required on every customization item; omit on base items

  billing (required)
    name            string — buyer's full name (mandatory)
    address (required)
      name          string? — address label / apartment name (optional)
      building      string? — building name (optional)
      locality      string  — area/neighborhood (mandatory)
      city          string  — city name, e.g. "Bengaluru" (mandatory)
      state         string  — state name, e.g. "Karnataka" (mandatory)
      country       "IND"   (mandatory)
      area_code     string  — 6-digit pin code, e.g. "560034" (mandatory)
    email           string  — buyer email (mandatory)
    phone           string  — buyer phone (mandatory)
    created_at      ISO8601 UTC — billing record creation time (mandatory)
    updated_at      ISO8601 UTC — billing record last update time (mandatory)

  fulfillments[] (required — send exactly ONE entry: the chosen Delivery fulfillment)
    id              string  — fulfillment ID from /on_select (e.g. "F1")
    type            "Delivery"

    end (required)
      location (required)
        gps         string  — buyer delivery GPS: "lat,lng"
        address (required)
          name      string? — address label / apartment name (optional)
          building  string? — building name (optional)
          locality  string  — area/neighborhood (mandatory)
          city      string  — city name (mandatory)
          state     string  — state name (mandatory)
          country   "IND"   (mandatory)
          area_code string  — 6-digit pin code (mandatory)
      contact (required)
        phone       string  — delivery contact phone (mandatory)
        email       string? — delivery contact email (optional)

    end.time.range (optional — include ONLY if buyer selected a delivery time slot from /on_select)
      start         ISO8601 UTC — slot start time
      end           ISO8601 UTC — slot end time

  payment (required)
    @ondc/org/buyer_app_finder_fee_type    "percent"
    @ondc/org/buyer_app_finder_fee_amount  "3"   — BAP's finder fee (3% of order value)
    type            "ON-ORDER"             — prepaid; buyer pays before delivery
    collected_by    "BAP"                  — BAP collects via its own payment gateway
```

---

## 4. /init Scenarios

### 4.1 Delivery — BAP Prepaid (plain items)

Standard F&B order: single non-customized item, buyer pays upfront via BAP's payment gateway.

```json
{
  "context": {
    "domain": "ONDC:RET11",
    "action": "init",
    "core_version": "1.2.0",
    "bap_id": "buyerNP.com",
    "bap_uri": "https://buyerNP.com/ondc",
    "bpp_id": "sellerNP.com",
    "bpp_uri": "https://sellerNP.com/ondc",
    "transaction_id": "T2",
    "message_id": "M3",
    "city": "std:080",
    "country": "IND",
    "timestamp": "2023-06-03T08:35:00.000Z",
    "ttl": "PT30S"
  },
  "message": {
    "order": {
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
            "contact": {
              "phone": "9886098860",
              "email": "buyer@example.com"
            }
          }
        }
      ],
      "payment": {
        "@ondc/org/buyer_app_finder_fee_type": "percent",
        "@ondc/org/buyer_app_finder_fee_amount": "3",
        "type": "ON-ORDER",
        "collected_by": "BAP"
      }
    }
  }
}
```

**Note**: Billing address and delivery address may differ. Billing is for invoice/GST purposes;
delivery is where the food goes. Always collect both from the buyer explicitly.

### 4.2 F&B Customized Items, Delivery, Prepaid

Items array mirrors `/select` exactly, with `fulfillment_id` added to every entry (base item +
all its customizations share the same `fulfillment_id`):

```json
{
  "context": {
    "domain": "ONDC:RET11",
    "action": "init",
    "transaction_id": "T2",
    "message_id": "M3",
    ...
  },
  "message": {
    "order": {
      "provider": { "id": "P1", "locations": [{ "id": "L1" }] },
      "items": [
        {
          "id": "I1", "parent_item_id": "DI1", "fulfillment_id": "F1",
          "location_id": "L1", "quantity": { "count": 1 },
          "tags": [{ "code": "type", "list": [{ "code": "type", "value": "item" }] }]
        },
        {
          "id": "C1", "parent_item_id": "DI1", "fulfillment_id": "F1",
          "location_id": "L1", "quantity": { "count": 1 },
          "tags": [
            { "code": "type",   "list": [{ "code": "type", "value": "customization" }] },
            { "code": "parent", "list": [{ "code": "id",   "value": "CG1" }] }
          ]
        },
        {
          "id": "C7", "parent_item_id": "DI1", "fulfillment_id": "F1",
          "location_id": "L1", "quantity": { "count": 1 },
          "tags": [
            { "code": "type",   "list": [{ "code": "type", "value": "customization" }] },
            { "code": "parent", "list": [{ "code": "id",   "value": "CG2" }] }
          ]
        },
        {
          "id": "I1", "parent_item_id": "DI2", "fulfillment_id": "F1",
          "location_id": "L1", "quantity": { "count": 1 },
          "tags": [{ "code": "type", "list": [{ "code": "type", "value": "item" }] }]
        },
        {
          "id": "C2", "parent_item_id": "DI2", "fulfillment_id": "F1",
          "location_id": "L1", "quantity": { "count": 1 },
          "tags": [
            { "code": "type",   "list": [{ "code": "type", "value": "customization" }] },
            { "code": "parent", "list": [{ "code": "id",   "value": "CG1" }] }
          ]
        }
      ],
      "billing": { "name": "Buyer Name", "address": { ... }, "email": "buyer@example.com", "phone": "9886098860", "created_at": "...", "updated_at": "..." },
      "fulfillments": [
        {
          "id": "F1",
          "type": "Delivery",
          "end": {
            "location": { "gps": "12.453544,77.928379", "address": { ... } },
            "contact": { "phone": "9886098860", "email": "buyer@example.com" }
          }
        }
      ],
      "payment": {
        "@ondc/org/buyer_app_finder_fee_type": "percent",
        "@ondc/org/buyer_app_finder_fee_amount": "3",
        "type": "ON-ORDER",
        "collected_by": "BAP"
      }
    }
  }
}
```

**Rules for F&B /init items array**:

- `fulfillment_id` is added to every item row — base item and all its customizations
- All items in a dynamic group (same `parent_item_id`) share the same `fulfillment_id`
- The type/parent tags are carried over unchanged from /select
- Quantity per item row is carried over unchanged from /select

### 4.3 Slotted Delivery — Buyer Selects Time Window

When BPP returned multiple delivery slot options in `/on_select`, the buyer picks one. BAP sends
the selected window in `fulfillments[].end.time.range`:

```json
{
  "fulfillments": [
    {
      "id": "F1",
      "type": "Delivery",
      "end": {
        "location": {
          "gps": "12.453544,77.928379",
          "address": {
            "locality": "Koramangala",
            "city": "Bengaluru",
            "area_code": "560034"
          }
        },
        "contact": { "phone": "9886098860" },
        "time": {
          "range": {
            "start": "2023-06-03T09:30:00.000Z",
            "end": "2023-06-03T10:00:00.000Z"
          }
        }
      }
    }
  ],
  "payment": {
    "@ondc/org/buyer_app_finder_fee_type": "percent",
    "@ondc/org/buyer_app_finder_fee_amount": "3",
    "type": "ON-ORDER",
    "collected_by": "BAP"
  }
}
```

**Note**: Slot must be one of the ranges returned by the BPP in `/on_select`. Do not send a
custom range — use the exact start/end timestamps from the selected fulfillment option.

---

## 5. /on_init Response — Payload Schema

```
context (required — echoes /init context, action changes to "on_init", no ttl)
  domain            "ONDC:RET11"
  action            "on_init"
  transaction_id    same as /init
  message_id        same as /init
  timestamp         BPP processing time
  bpp_id            BPP subscriber ID
  bpp_uri           BPP endpoint URL

message.order (required)

  provider
    id              string — same provider ID
    locations[]
      id            string — same (or updated) location ID

  items[]           — mirrors items sent in /init, with fulfillment_id confirmed
    id              string
    parent_item_id  string? — same dynamic item ID (for F&B)
    fulfillment_id  string  — confirmed fulfillment assignment
    tags[]          — same type+parent tags as /init

  billing           — echoed back from /init

  fulfillments[]    — confirmed fulfillment details
    id              string
    type            "Delivery"
    @ondc/org/provider_name  string — LSP or provider name
    tracking        boolean
    @ondc/org/category       "Immediate Delivery"
    @ondc/org/TAT   string — ISO8601 duration, e.g. "PT60M"
    state
      descriptor
        code        "Serviceable"
    end.time.range  (confirmed time slot, if slotted delivery was requested)
      start         ISO8601 UTC
      end           ISO8601 UTC

  quote (FROZEN — authoritative amount BAP must charge buyer)
    price
      currency      "INR"
      value         string — total; BAP MUST validate == Σ breakup[].price.value
    breakup[]
      @ondc/org/item_id       string — catalog item ID or fulfillment ID (F1…)
      @ondc/org/item_quantity (for title_type="item")
        count       integer — confirmed quantity (may differ if BPP adjusted stock)
      title         string — display name
      @ondc/org/title_type    "item" | "delivery" | "tax" | "packing" | "discount" | "misc" | "offer"
      price
        currency    "INR"
        value       string — may be negative for discounts
      item (for item/customization lines)
        parent_item_id  string? — DI* for F&B dynamic items
        quantity
          available.count  string
          maximum.count    string
        price.value string — unit price
        tags[]      — same type/parent tags
    ttl             string? — not typically present; quote is frozen at this point

  payment (required — BPP confirms payment terms)
    @ondc/org/buyer_app_finder_fee_type    "percent" — echoed from /init
    @ondc/org/buyer_app_finder_fee_amount  "3"       — echoed from /init
    type            "ON-ORDER"             — echoed from /init
    collected_by    "BAP"                  — confirmed: BAP collects

  cancellation_terms[] (required — BPP defines fee schedule per fulfillment state)
    — See §7 for full format and F&B defaults
```

---

## 6. /on_init Scenarios

### 6.1 BAP Collects Prepaid — Standard Response

```json
{
  "context": {
    "domain": "ONDC:RET11",
    "action": "on_init",
    "core_version": "1.2.0",
    "bap_id": "buyerNP.com",
    "bap_uri": "https://buyerNP.com/ondc",
    "bpp_id": "sellerNP.com",
    "bpp_uri": "https://sellerNP.com/ondc",
    "transaction_id": "T2",
    "message_id": "M3",
    "city": "std:080",
    "country": "IND",
    "timestamp": "2023-06-03T08:35:30.000Z"
  },
  "message": {
    "order": {
      "provider": { "id": "P1", "locations": [{ "id": "L1" }] },
      "items": [
        { "id": "I1", "fulfillment_id": "F1", "quantity": { "count": 1 } }
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
          "state": { "descriptor": { "code": "Serviceable" } },
          "end": {
            "location": {
              "gps": "12.453544,77.928379",
              "address": {
                "locality": "Koramangala",
                "city": "Bengaluru",
                "area_code": "560034"
              }
            },
            "contact": { "phone": "9886098860", "email": "buyer@example.com" },
            "time": {
              "range": {
                "start": "2023-06-03T09:35:00.000Z",
                "end": "2023-06-03T10:35:00.000Z"
              }
            }
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
        "collected_by": "BAP"
      },
      "cancellation_terms": [
        {
          "fulfillment_state": {
            "descriptor": {
              "code": "Pending",
              "short_desc": "001,003,051,052,053,009"
            }
          },
          "reason_required": false,
          "return_policy": { "return_eligible": false },
          "cancel_by": { "duration": "PT1H" },
          "cancellation_fee": { "percentage": "0.00" }
        },
        {
          "fulfillment_state": {
            "descriptor": {
              "code": "Packed",
              "short_desc": "001,003,051,052,053,009"
            }
          },
          "reason_required": false,
          "return_policy": { "return_eligible": false },
          "cancellation_fee": { "percentage": "100.00" }
        },
        {
          "fulfillment_state": {
            "descriptor": {
              "code": "Order-picked-up",
              "short_desc": "001,003,051,052,053,009"
            }
          },
          "reason_required": false,
          "return_policy": { "return_eligible": false },
          "cancellation_fee": { "percentage": "100.00" }
        },
        {
          "fulfillment_state": {
            "descriptor": {
              "code": "Out-for-delivery",
              "short_desc": "001,003,051,052,053,009"
            }
          },
          "reason_required": false,
          "return_policy": { "return_eligible": false },
          "cancellation_fee": { "percentage": "100.00" }
        }
      ]
    }
  }
}
```

After receiving this, BAP triggers its payment gateway with `quote.price.value = "264.00"`.
See `payment-bap-prepaid.md` for the full PG integration and `/confirm` payment fields.

### 6.2 Quote Changed from /on_select

BPP may adjust the quote between `/on_select` and `/on_init` (e.g., delivery charge updated
due to address, packing charge added). BAP must detect and show the diff to the buyer.

**Detection logic:**

```
if on_init.quote.price.value != stored on_select.quote.price.value:
  diff_amount = on_init.quote.price.value - on_select.quote.price.value
  find which breakup category changed (compare each title_type line)
  show change to buyer: e.g. "Delivery charge updated: ₹50 → ₹75"
  require buyer re-confirmation before triggering payment gateway
  do NOT charge the old /on_select amount
```

**If BPP reduces item quantity:**

- Some `@ondc/org/item_quantity.count` in breakup < what BAP sent in `/init`
- Notify buyer of the reduction; if buyer objects, trigger re-select flow

**CRITICAL**: Always use the frozen `/on_init` quote amount when charging the buyer — never
use the `/on_select` quote. These can legitimately differ.

### 6.3 F&B Customized Items — Full /on_init

For F&B with customizations, the `/on_init` items array and quote breakup mirror `/on_select`
exactly (same `parent_item_id`, `fulfillment_id`, type/parent tags on each row). The quote
breakup structure is identical to `/on_select` §5.4 in `select-on-select.md` — one `item`
breakup row per base item + per customization, per dynamic group, plus fulfillment cost rows.

The only difference from `/on_select`: the quote is now authoritative (frozen). BAP charges
the buyer exactly `quote.price.value` from this response.

---

## 7. Cancellation Terms — Format and Rules

### Structure of each cancellation_term entry

```json
{
  "fulfillment_state": {
    "descriptor": {
      "code": "<FulfillmentState>",
      "short_desc": "<comma-separated eligible cancellation reason codes>"
    }
  },
  "reason_required": false,
  "return_policy": {
    "return_eligible": false
  },
  "cancel_by": {
    "duration": "PT1H"
  },
  "cancellation_fee": {
    "percentage": "0.00"
    // OR: "amount": { "currency": "INR", "value": "50.00" }
  }
}
```

### Field-by-field explanation

| Field                                     | Type    | Meaning                                                                                            |
| ----------------------------------------- | ------- | -------------------------------------------------------------------------------------------------- |
| `fulfillment_state.descriptor.code`       | string  | Fulfillment state for which these terms apply                                                      |
| `fulfillment_state.descriptor.short_desc` | string  | Comma-separated reason codes valid at this state                                                   |
| `reason_required`                         | boolean | Whether a reason code is mandatory with `/cancel`                                                  |
| `return_policy.return_eligible`           | boolean | F&B is always `false` — food cannot be returned                                                    |
| `cancel_by.duration`                      | ISO8601 | How long buyer has to cancel once in this state. If absent, cancel is always allowed at this state |
| `cancellation_fee.percentage`             | string  | Percentage of order value charged as cancellation fee                                              |
| `cancellation_fee.amount`                 | object  | Fixed fee (alternative to percentage)                                                              |

### F&B Typical Cancellation Terms

F&B orders are non-returnable. Typical BPP policy:

| State              | Fee      | Reason                                     |
| ------------------ | -------- | ------------------------------------------ |
| `Pending`          | **0%**   | Order not yet started — free cancel        |
| `Packed`           | **100%** | Food prepared — full order value charged   |
| `Order-picked-up`  | **100%** | In delivery — full order value charged     |
| `Out-for-delivery` | **100%** | About to arrive — full order value charged |

BPPs may define custom fees. Store the exact terms from `/on_init` — do not assume defaults.

### How BAP uses cancellation terms

**Pre-cancel fee display** (show before buyer confirms cancel):

```
current_state = "Packed"
matching_term = cancellation_terms[].where(fulfillment_state.code == current_state)
if matching_term.cancellation_fee.percentage:
  fee = order_value_at_confirm × (percentage / 100)
else if matching_term.cancellation_fee.amount:
  fee = fixed_amount
display: "Cancellation fee: ₹{fee}"
```

**Post-cancel fee calculation** (when BPP doesn't respond to `/cancel` in time):

```
use stored cancellation_terms[state=current_state] fee → calculate locally
no need to wait for /on_cancel for fee calculation in this case
```

---

## 8. Enum Reference Tables

### Fulfillment `type` (this project)

| Value      | Status                           |
| ---------- | -------------------------------- |
| `Delivery` | ✓ Only type used in this project |

### Fulfillment `state.descriptor.code` (in /on_init)

| Value         | Meaning                               |
| ------------- | ------------------------------------- |
| `Serviceable` | BPP confirmed fulfillment can proceed |

### Fulfillment `@ondc/org/category`

| Value                | Description                  |
| -------------------- | ---------------------------- |
| `Immediate Delivery` | On-demand / express delivery |

### Payment `type` (this project)

| Value      | Status                                                |
| ---------- | ----------------------------------------------------- |
| `ON-ORDER` | ✓ Only type used — buyer pays upfront before delivery |

### Payment `collected_by` (this project)

| Value | Status                                                                     |
| ----- | -------------------------------------------------------------------------- |
| `BAP` | ✓ Always — BAP handles payment gateway; BPP never collects in this project |

### Quote `@ondc/org/title_type`

| Value      | What it covers                             |
| ---------- | ------------------------------------------ |
| `item`     | Item / customization price                 |
| `delivery` | Delivery charge                            |
| `tax`      | Tax on item or fulfillment                 |
| `packing`  | Packing charge                             |
| `discount` | Discount (negative value)                  |
| `misc`     | Miscellaneous fees (convenience fee, etc.) |
| `offer`    | Applied offer (may be negative)            |

### F&B Fulfillment States (order lifecycle)

| State              | Meaning                                |
| ------------------ | -------------------------------------- |
| `Pending`          | Order accepted; not yet being prepared |
| `Packed`           | Food prepared and packed               |
| `Order-picked-up`  | Delivery agent collected the order     |
| `Out-for-delivery` | En route to buyer                      |
| `Order-delivered`  | Successfully delivered                 |
| `Cancelled`        | Order cancelled                        |

---

## 9. Error Codes

### Errors in /on_init (BPP → BAP)

| Code    | Type         | Meaning                                                      | BAP action                                 |
| ------- | ------------ | ------------------------------------------------------------ | ------------------------------------------ |
| `30001` | DOMAIN-ERROR | Item not found — item in /init no longer in BPP catalog      | Show error; re-call /select                |
| `30004` | DOMAIN-ERROR | Item quantity unavailable                                    | Inform buyer; adjust cart; re-call /select |
| `30009` | DOMAIN-ERROR | No items available / non-serviceable                         | Show error; abort order session            |
| `30006` | DOMAIN-ERROR | Offer no longer valid                                        | Remove offer; re-call /select              |
| `30007` | DOMAIN-ERROR | Offer valid but fulfillment impossible (freebie unavailable) | Remove offer; re-call /select              |
| `30023` | DOMAIN-ERROR | Cart below minimum order value                               | Inform buyer; add items; re-call /select   |
| `40002` | DOMAIN-ERROR | Item out of stock                                            | Adjust cart; re-call /select               |

### NACK errors BAP sends

| Code    | When                                                                                            |
| ------- | ----------------------------------------------------------------------------------------------- |
| `20002` | BAP NACKs a stale `/on_init` (timestamp earlier than previously processed for same transaction) |
| `20000` | BAP NACKs `/on_init` with invalid context                                                       |

### NACK response shape

```json
{
  "message": { "ack": { "status": "NACK" } },
  "error": {
    "type": "DOMAIN-ERROR",
    "code": "20000",
    "message": "Invalid context"
  }
}
```

---

## 10. Cancellation Reason Codes (Retail — Current)

These codes are used in `/cancel` requests and returned in `/on_cancel` callbacks.
From ONDC Reason Codes document (updated May 2025).

### Buyer NP (BNP) — codes BAP sends in /cancel

| Code | Phase | Reason | States Applicable |
|------|-------|--------|-------------------|
| `001` | pre-pickup | Price of one or more items changed (buyer asked additional payment) | Pending, Packed, Agent-assigned, Out-for-pickup |
| `003` | pre-pickup | Product available at lower than order price | Pending, Packed, Agent-assigned, Out-for-pickup |
| `051` (was `004`) | pre-pickup | Store is not accepting order | Pending |
| `052` (was `006`) | post-pickup | Order/fulfillment not received as per O2D TAT | Order-picked-up, At-delivery |
| `053` (was `010`) | any | Buyer wants to modify address / other order details | Any state prior to Order-delivered |
| `009` | post-pickup | Wrong product delivered | At-delivery |

> **Note on reason code history**: Codes `004`, `006`, and `010` were deprecated and replaced by `051`, `052`, and `053` respectively. BPPs may still return the old codes; BAP should treat them as equivalent.

### Seller NP (SNP) — codes BPP sends in /on_cancel (BAP must handle)

| Code | Phase | Reason |
|------|-------|--------|
| `002` | pre-pickup | One or more items in the order not available |
| `021` | pre-pickup | Store not responsive (auto-accepted but unresponsive) |
| `022` | pre-pickup | Technical issue in merchant device |
| `023` | pre-pickup | Order received during non-operational hours |
| `024` | pre-pickup | Order received during store rush |
| `011` | post-pickup | Retail buyer not found / can't be contacted |
| `013` | post-pickup | Retail buyer can't/doesn't want to accept delivery |
| `014` | post-pickup | Delivery address incorrect or not found |
| `016` | post-pickup | Force majeure (accident/strike/law & order) |
| `018` | post-pickup | Order not serviceable (logistics issue) |

### Special internal codes (not for /cancel in post-confirm flow)

| Code | Who | Meaning |
|------|-----|---------|
| `999` | BNP | Order confirmation failure (internal — pre-confirm only) |
| `998` | SNP | Order confirmation failure (internal — pre-confirm only) |

### Part Cancellation Rules

**Full vs. part cancellation:**

- **Full cancel**: entire order is cancelled via `/cancel`
- **Part cancel**: only some items/fulfillments cancelled. Rules:
  - If `Order.state = "Created"`: part cancel at **item level** (via `/cancel` with specific fulfillment)
  - If `Order.state` is anything else: part cancel at **fulfillment level** only
  - Part cancel is only possible when `@ondc/org/cancellable = "true"` in the catalog for all items

### Settlement Details on Refund

After `/on_cancel` for a prepaid order, BAP updates `Order.payment` with settlement trail:

```json
{
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
```

**Refund amount rules:**
- Pre-shipment cancellation: full item amount minus logistics costs (buyer app discretion)
- Post-shipment cancellation: full item amount (logistics already incurred)
- F&B is non-returnable — returns do not apply to food items

### Logistics Provider (LSP) Cancellation

LSP can initiate cancellation (RTO flow):
- LSP sends cancellation request to the entity that confirmed the logistics order
- LSP includes cancellation reason + AWB number
- If cause is LSP's fault: entity that confirmed (Seller App or Buyer App) finds replacement LSP
- If no replacement LSP available: retail order is cancelled, buyer gets refund

---

## 11. BAP Processing Algorithm for /on_init

```
receive /on_init webhook
│
├─ 1. Verify Ed25519 signature (Registry public key lookup)
│      HTTP 401 NACK if Authorization header missing or signature invalid
│
├─ 2. Validate context
│      action == "on_init" AND bpp_id present AND transaction_id matches open session
│      NACK 200 DOMAIN-ERROR 20000 if invalid
│      NACK 200 DOMAIN-ERROR 20002 if timestamp is stale (older than last /on_init for this txn)
│
├─ 3. ACK immediately (200 OK with ACK) — processing is async
│
└─ 4. Async processing:
   │
   ├─ 4a. Check for BPP errors
   │       30001 → item removed; re-call /select; notify buyer
   │       30004/40002 → quantity issue; adjust cart; re-call /select
   │       30006/30007 → offer invalid; remove offer; re-call /select
   │       30009 → non-serviceable; abort order session; notify buyer
   │       30023 → min order value; prompt buyer to add items; re-call /select
   │
   ├─ 4b. Validate frozen quote integrity
   │       Σ breakup[].price.value (signed) == quote.price.value
   │       For each item breakup: item.price.value × item_quantity.count == breakup price.value
   │       If mismatch → do NOT trigger payment; force re-select; log discrepancy
   │
   ├─ 4c. Detect quote change from /on_select
   │       on_init.quote.price.value != stored on_select.quote.price.value
   │         → compute delta per breakup category
   │         → show diff to buyer; require buyer re-confirmation
   │         → do NOT trigger payment until buyer confirms the new amount
   │       If BPP reduced item quantity in breakup vs /init:
   │         → notify buyer; require re-confirmation or re-select
   │
   ├─ 4d. Store cancellation terms
   │       persist full cancellation_terms[] array in order session (keyed by transaction_id)
   │       used for: pre-cancel fee display + post-cancel fee calculation if BPP doesn't respond
   │
   ├─ 4e. Store confirmed fulfillment details
   │       persist: fulfillment ID, TAT, confirmed time slot (if any)
   │       update order session state = "init_complete"
   │
   └─ 4f. Trigger payment gateway (see payment-bap-prepaid.md for full detail)
           amount to charge = on_init.quote.price.value   ← ALWAYS use this, not /on_select
           on PG success → send /confirm with payment.status = "PAID" + transaction_id = PG ref
           on PG failure → show error to buyer; offer retry (do NOT re-call /init)
           on PG timeout → treat as failure; offer retry
```

---

## Quick Reference — /init + /on_init

**BAP sends in /init** (all mandatory):

- `context.action = "init"`, `ttl = "PT30S"`, same `transaction_id` as /select, new `message_id`
- `provider.id` + `provider.locations[].id` — from /on_select (use updated location if BPP changed it)
- `items[]` — identical to /select, with `fulfillment_id` added to every row
- `billing` — name, full address (locality/city/state/country/area_code), email, phone, created_at, updated_at
- `fulfillments[]` — one entry only: chosen Delivery fulfillment, `end.location` gps + full address, `end.contact.phone`
- `payment` — `type: "ON-ORDER"`, `collected_by: "BAP"`, finder fee type + amount

**BAP receives in /on_init** (critical):

- `quote` — FROZEN; validate integrity; compare vs /on_select; charge this amount (not /on_select amount)
- `payment.collected_by` — must be `"BAP"` (verify; flag if unexpected)
- `cancellation_terms[]` — store for pre-cancel fee display and post-cancel calculation
- `fulfillments[].@ondc/org/TAT` — confirmed delivery TAT

**Common mistakes to avoid**:

- Forgetting `fulfillment_id` on items → BPP may NACK or assign wrong fulfillment
- Using billing address as delivery address — they can differ (billing = invoice/GST; delivery = food destination)
- Charging buyer the `/on_select` price instead of the frozen `/on_init` price
- Not storing `cancellation_terms[]` — needed for fee calculation and pre-cancel display
- Triggering payment before buyer re-confirms when quote changed in /on_init
- Not re-calling `/select` when cart changes (calling `/init` with modified items is incorrect)
