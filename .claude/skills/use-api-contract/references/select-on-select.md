# /select + /on_select Deep Reference — ONDC F&B (ONDC:RET11)

> **When to read this file**: Any time you are implementing or debugging `/select` (sending cart to BPP)
> or `/on_select` (receiving quote + serviceability response). Contains complete payload schemas,
> enum tables, quote validation rules, error codes, and BAP processing algorithms.

---

## Table of Contents

1. [Overview — Select Flow](#1-overview--select-flow)
2. [/select Request — Payload Schema](#2-select-request--payload-schema)
3. [/select Scenarios](#3-select-scenarios)
   - 3.1 F&B with Customizations (make-to-order)
   - 3.2 Non-Customized Items
4. [/on_select Response — Payload Schema](#4-on_select-response--payload-schema)
5. [/on_select Scenarios](#5-on_select-scenarios)
   - 5.1 Serviceable (item in stock)
   - 5.2 Item out of stock (error 40002)
   - 5.3 Non-serviceable (error 30009)
   - 5.4 F&B with Customizations — full quote
   - 5.5 Offers in quote
   - 5.6 Multiple fulfillment types (Delivery + Self-Pickup + Buyer-Delivery)
   - 5.7 Slotted delivery / time slots
6. [Enum Reference Tables](#6-enum-reference-tables)
7. [Quote Validation Rules (BAP must enforce)](#7-quote-validation-rules-bap-must-enforce)
8. [Error Codes](#8-error-codes)
9. [Dynamic Item ID — F&B CG Contract](#9-dynamic-item-id--fb-cg-contract)
10. [BAP Processing Algorithm for /on_select](#10-bap-processing-algorithm-for-on_select)

---

## 1. Overview — Select Flow

```
BAP → BPP : /select   (cart with items + customization selections + delivery location + payment preference)
BPP → BAP : /on_select (serviceability check + quote + fulfillment options)
```

**Rules**:

- BAP must call `/select` again if the delivery address changes
- BAP must call `/select` again if the cart changes in `/on_init` (BPP reduces quantity)
- Quote from `/on_select` is **NOT frozen** — it only becomes frozen at `/on_init`
- `/select` context `action` = `"select"`, TTL = `"PT30S"`
- `/on_select` echoes the same `transaction_id` and `message_id` from `/select`

---

## 2. /select Request — Payload Schema

```
context (required)
  domain            "ONDC:RET11"
  action            "select"
  core_version      "1.2.0"
  bap_id            string — BAP subscriber ID
  bap_uri           string — BAP callback URL
  bpp_id            string — BPP subscriber ID
  bpp_uri           string — BPP endpoint URL
  transaction_id    string — unique per order session (BAP generated, same across /select→/confirm)
  message_id        string — unique per API call
  city              string — "std:080" format
  country           "IND"
  timestamp         ISO8601 UTC
  ttl               "PT30S"

message.order (required)
  provider (required)
    id              string — BPP provider ID from catalog
    locations[]
      id            string — provider location ID from catalog

  items[] (required — one entry per base item or customization)
    id              string — catalog item/customization ID
    parent_item_id  string? — BAP-generated dynamic group ID (DI1, DI2…)
                              REQUIRED for F&B customized items (groups base + all its customizations)
                              OMIT for non-customized items
    location_id     string — provider location ID
    quantity
      count         integer — ordered quantity
    tags[]
      (required for F&B customized items, omit for plain items)
      { code:"type",   list:[{code:"type",   value:"item"|"customization"}] }
      { code:"parent", list:[{code:"id",     value:"<CG_ID>"}] }
        — REQUIRED on every customization item (identifies which CG it belongs to)
        — OMIT on base items

  offers[]  (optional — buyer opt-in or opt-out of offers)
    id              string — offer ID from catalog
    tags[]
      { code:"selection", list:[{code:"apply", value:"yes"|"no"}] }

  fulfillments[] (required)
    end.location
      gps           string — buyer delivery lat,lng
      address
        area_code   string — buyer pin code

  payment (required)
    type            "ON-FULFILLMENT" | "ON-ORDER" | "PRE-FULFILLMENT" | "POST-FULFILLMENT"
                    — buyer's preferred payment mode
```

---

## 3. /select Scenarios

### 3.1 F&B with Customizations (make-to-order) — Domino's Pizza example

Context: buyer selects 2 dynamic items (DI1, DI2), each a Farmhouse Pizza with different customizations.

```json
{
  "context": {
    "domain": "ONDC:RET11",
    "action": "select",
    "core_version": "1.2.0",
    "bap_id": "buyerNP.com",
    "bap_uri": "https://buyerNP.com/ondc",
    "bpp_id": "sellerNP.com",
    "bpp_uri": "https://sellerNP.com/ondc",
    "transaction_id": "T2",
    "message_id": "M2",
    "city": "std:080",
    "country": "IND",
    "timestamp": "2023-06-03T08:30:00.000Z",
    "ttl": "PT30S"
  },
  "message": {
    "order": {
      "provider": {
        "id": "P1",
        "locations": [{ "id": "L1" }]
      },
      "items": [
        {
          "id": "I1",
          "parent_item_id": "DI1",
          "location_id": "L1",
          "quantity": { "count": 1 },
          "tags": [
            { "code": "type", "list": [{ "code": "type", "value": "item" }] }
          ]
        },
        {
          "id": "C1",
          "parent_item_id": "DI1",
          "location_id": "L1",
          "quantity": { "count": 1 },
          "tags": [
            {
              "code": "type",
              "list": [{ "code": "type", "value": "customization" }]
            },
            { "code": "parent", "list": [{ "code": "id", "value": "CG1" }] }
          ]
        },
        {
          "id": "C7",
          "parent_item_id": "DI1",
          "location_id": "L1",
          "quantity": { "count": 1 },
          "tags": [
            {
              "code": "type",
              "list": [{ "code": "type", "value": "customization" }]
            },
            { "code": "parent", "list": [{ "code": "id", "value": "CG2" }] }
          ]
        },
        {
          "id": "C14",
          "parent_item_id": "DI1",
          "location_id": "L1",
          "quantity": { "count": 1 },
          "tags": [
            {
              "code": "type",
              "list": [{ "code": "type", "value": "customization" }]
            },
            { "code": "parent", "list": [{ "code": "id", "value": "CG3" }] }
          ]
        },
        {
          "id": "C16",
          "parent_item_id": "DI1",
          "location_id": "L1",
          "quantity": { "count": 1 },
          "tags": [
            {
              "code": "type",
              "list": [{ "code": "type", "value": "customization" }]
            },
            { "code": "parent", "list": [{ "code": "id", "value": "CG3" }] }
          ]
        },
        {
          "id": "I1",
          "parent_item_id": "DI2",
          "location_id": "L1",
          "quantity": { "count": 1 },
          "tags": [
            { "code": "type", "list": [{ "code": "type", "value": "item" }] }
          ]
        },
        {
          "id": "C2",
          "parent_item_id": "DI2",
          "location_id": "L1",
          "quantity": { "count": 1 },
          "tags": [
            {
              "code": "type",
              "list": [{ "code": "type", "value": "customization" }]
            },
            { "code": "parent", "list": [{ "code": "id", "value": "CG1" }] }
          ]
        },
        {
          "id": "C7",
          "parent_item_id": "DI2",
          "location_id": "L1",
          "quantity": { "count": 1 },
          "tags": [
            {
              "code": "type",
              "list": [{ "code": "type", "value": "customization" }]
            },
            { "code": "parent", "list": [{ "code": "id", "value": "CG2" }] }
          ]
        },
        {
          "id": "C14",
          "parent_item_id": "DI2",
          "location_id": "L1",
          "quantity": { "count": 1 },
          "tags": [
            {
              "code": "type",
              "list": [{ "code": "type", "value": "customization" }]
            },
            { "code": "parent", "list": [{ "code": "id", "value": "CG3" }] }
          ]
        },
        {
          "id": "C15",
          "parent_item_id": "DI2",
          "location_id": "L1",
          "quantity": { "count": 1 },
          "tags": [
            {
              "code": "type",
              "list": [{ "code": "type", "value": "customization" }]
            },
            { "code": "parent", "list": [{ "code": "id", "value": "CG3" }] }
          ]
        }
      ],
      "offers": [
        {
          "id": "BUY2GET3",
          "tags": [
            {
              "code": "selection",
              "list": [{ "code": "apply", "value": "yes" }]
            }
          ]
        }
      ],
      "fulfillments": [
        {
          "end": {
            "location": {
              "gps": "12.453544,77.928379",
              "address": { "area_code": "560001" }
            }
          }
        }
      ],
      "payment": { "type": "ON-FULFILLMENT" }
    }
  }
}
```

**Key rules for F&B customized /select**:

- One `parent_item_id` per "dynamic item" groups ONE base item + ALL its chosen customizations
- The same catalog item ID can appear multiple times with different `parent_item_id` (buyer ordered the same base item twice with different customizations)
- The same customization ID (e.g. C7 = "Large") can appear under multiple `parent_item_id`
- Each customization must have `tags[code="parent"].list[code="id"].value` = the CG it belongs to
- BAP generates dynamic IDs (DI1, DI2…) — they have no meaning outside this transaction

### 3.2 Non-Customized Items

For items with no customization groups, omit `parent_item_id` and tags:

```json
{
  "message": {
    "order": {
      "provider": { "id": "P1", "locations": [{ "id": "L1" }] },
      "items": [
        { "id": "I1", "location_id": "L1", "quantity": { "count": 2 } }
      ],
      "offers": [
        {
          "id": "BUY2GET3",
          "tags": [
            {
              "code": "selection",
              "list": [{ "code": "apply", "value": "yes" }]
            }
          ]
        }
      ],
      "fulfillments": [
        {
          "end": {
            "location": {
              "gps": "12.453544,77.928379",
              "address": { "area_code": "560001" }
            }
          }
        }
      ],
      "payment": { "type": "ON-FULFILLMENT" }
    }
  }
}
```

---

## 4. /on_select Response — Payload Schema

```
context (required — echoes /select context with action="on_select", no ttl)
  domain            "ONDC:RET11"
  action            "on_select"
  transaction_id    same as /select
  message_id        same as /select
  timestamp         BPP processing time

message.order (required)
  provider
    id              string — same as /select
    locations[]     — BPP may optionally return a DIFFERENT location if fulfillment is from
                      a different store than buyer selected (non-hyperlocal). BAP must use this
                      updated location in /init if it differs.

  items[]           — mirrors items sent in /select, each with fulfillment_id added
    id              string
    parent_item_id  string? — same DI* as sent in /select
    fulfillment_id  string  — F1, F2… (which fulfillment handles this item)
    tags[]          — same type/parent tags as in /select

  fulfillments[]    — serviceability result + fulfillment options
    id              string
    type            "Delivery" | "Self-Pickup" | "Buyer-Delivery"
    @ondc/org/provider_name  string — LSP name or provider name
    tracking        boolean
    @ondc/org/category  string — see enum table
    @ondc/org/TAT   string — ISO8601 duration, e.g. "PT60M"
    state
      descriptor
        code        "Serviceable" | "Non-serviceable"
    end.time.range  (optional, for slotted delivery)
      start         ISO8601 UTC
      end           ISO8601 UTC
    start.time.range (optional, for self-pickup slots)
      start         ISO8601 UTC
      end           ISO8601 UTC
    tags[]          (optional, for Buyer-Delivery — package dimensions)
      { code:"weight",  list:[{code:"unit",value:"kilogram"},{code:"value",value:"<N>"}] }
      { code:"length",  list:[{code:"unit",value:"centimeter"},{code:"value",value:"<N>"}] }
      { code:"breadth", list:[{code:"unit",value:"centimeter"},{code:"value",value:"<N>"}] }
      { code:"height",  list:[{code:"unit",value:"centimeter"},{code:"value",value:"<N>"}] }

  quote (required when serviceable)
    price
      currency      "INR"
      value         string — total order value = Σ breakup[].price.value
    breakup[]       — one entry per item/customization/fulfillment cost line
      @ondc/org/item_id       string — catalog item ID, OR fulfillment ID (F1, F2…) for fulfillment costs
      @ondc/org/item_quantity (only for title_type="item" or "offer" freebie)
        count       integer — quantity in quote (may differ from requested if stock reduced)
      title         string — display name for this line
      @ondc/org/title_type  string — see enum table
      price
        currency    "INR"
        value       string — monetary value (may be negative for discounts/offers)
      item          (only for title_type="item" OR tax/offer entries that need context)
        parent_item_id  string? — DI* dynamic item ID (for F&B customized items)
        quantity
          available.count  string — "99" in stock, "0" out of stock
          maximum.count    string
        price
          currency  "INR"
          value     string — unit price for this item/customization
        tags[]
          — SAME tags as in /select (type + parent) — present on every item/customization breakup entry
          (optional) { code:"quote", list:[{code:"type",value:"item"|"fulfillment"|"order"}] }
            — used to specify level for tax/offer/misc entries
          (optional) { code:"offer", list:[...] }
            — used for offer breakup entries (see offer enum below)
    ttl             string — ISO8601 duration, e.g. "P1D" or "PT1H" or "PT30M"
                             BAP must re-call /select if quote has expired before /init

error  (optional — present when there is a serviceability or stock issue)
  type              "DOMAIN-ERROR"
  code              string — e.g. "40002", "30009", "30023"
  message           string — stringified JSON for multi-item stock errors (see §8)
```

---

## 5. /on_select Scenarios

### 5.1 Serviceable, Item In Stock

```json
{
  "context": { "domain": "ONDC:RET11", "action": "on_select", "transaction_id": "T2", "message_id": "M2", ... },
  "message": {
    "order": {
      "provider": { "id": "P1", "locations": [{ "id": "L1" }] },
      "items": [{ "fulfillment_id": "F1", "id": "I1" }],
      "fulfillments": [{
        "id": "F1", "type": "Delivery",
        "@ondc/org/provider_name": "LSP or Provider Name",
        "tracking": false,
        "@ondc/org/category": "Immediate Delivery",
        "@ondc/org/TAT": "PT60M",
        "state": { "descriptor": { "code": "Serviceable" } }
      }],
      "quote": {
        "price": { "currency": "INR", "value": "264" },
        "breakup": [
          {
            "@ondc/org/item_id": "I1", "@ondc/org/item_quantity": { "count": 1 },
            "title": "Item Name", "@ondc/org/title_type": "item",
            "price": { "currency": "INR", "value": "170.00" },
            "item": {
              "quantity": { "available": { "count": "99" }, "maximum": { "count": "99" } },
              "price": { "currency": "INR", "value": "170.00" }
            }
          },
          { "@ondc/org/item_id": "F1", "title": "Delivery charges", "@ondc/org/title_type": "delivery", "price": { "currency": "INR", "value": "50.00" } },
          { "@ondc/org/item_id": "F1", "title": "Tax", "@ondc/org/title_type": "tax", "price": { "currency": "INR", "value": "9.00" },
            "item": { "tags": [{ "code": "quote", "list": [{ "code": "type", "value": "fulfillment" }] }] } },
          { "@ondc/org/item_id": "F1", "title": "Packing charges", "@ondc/org/title_type": "packing", "price": { "currency": "INR", "value": "25.00" } },
          { "@ondc/org/item_id": "I1", "title": "Tax", "@ondc/org/title_type": "tax", "price": { "currency": "INR", "value": "0.00" } },
          { "@ondc/org/item_id": "F1", "title": "Convenience Fee", "@ondc/org/title_type": "misc", "price": { "currency": "INR", "value": "10.00" } }
        ],
        "ttl": "P1D"
      }
    }
  }
}
```

### 5.2 Item Out of Stock (error 40002)

When item count = 0:

```json
{
  "message": {
    "order": {
      "provider": { "id": "P1", "locations": [{ "id": "L1" }] },
      "items": [{ "fulfillment_id": "F1", "id": "I1" }],
      "fulfillments": [{ "id": "F1", "type": "Delivery", ..., "state": { "descriptor": { "code": "Serviceable" } } }],
      "quote": {
        "price": { "currency": "INR", "value": "0" },
        "breakup": [
          {
            "@ondc/org/item_id": "I1", "@ondc/org/item_quantity": { "count": 0 },
            "title": "Item Name", "@ondc/org/title_type": "item",
            "price": { "currency": "INR", "value": "0" },
            "item": {
              "quantity": { "available": { "count": "0" }, "maximum": { "count": "0" } },
              "price": { "currency": "INR", "value": "170" }
            }
          },
          { "@ondc/org/item_id": "F1", "title": "Delivery charges", "@ondc/org/title_type": "delivery", "price": { "currency": "INR", "value": "0.00" } }
        ],
        "ttl": "P1D"
      }
    }
  },
  "error": { "type": "DOMAIN-ERROR", "code": "40002", "message": "M1" }
}
```

### 5.3 Non-Serviceable (error 30009)

```json
{
  "message": {
    "order": {
      "fulfillments": [
        {
          "id": "F1",
          "type": "Delivery",
          "@ondc/org/category": "",
          "@ondc/org/TAT": "",
          "state": { "descriptor": { "code": "Non-serviceable" } }
        }
      ],
      "quote": {
        "price": { "currency": "INR", "value": "170.00" },
        "breakup": [
          {
            "@ondc/org/item_id": "I1",
            "@ondc/org/item_quantity": { "count": 1 },
            "title": "Item Name",
            "@ondc/org/title_type": "item",
            "price": { "currency": "INR", "value": "170.00" },
            "item": {
              "quantity": {
                "available": { "count": "99" },
                "maximum": { "count": "99" }
              },
              "price": { "currency": "INR", "value": "170.00" }
            }
          }
        ],
        "ttl": "P1D"
      }
    }
  },
  "error": { "type": "DOMAIN-ERROR", "code": "30009" }
}
```

### 5.4 F&B with Customizations — Full Quote (ONDC:RET11)

Response to the /select in §3.1 — 2 dynamic items, total 1955.65 INR.

**Items array** (BPP echoes each item with `fulfillment_id` added):

```json
"items": [
  { "id": "I1",  "fulfillment_id": "F1", "parent_item_id": "DI1", "tags": [{"code":"type","list":[{"code":"type","value":"item"}]}] },
  { "id": "C1",  "fulfillment_id": "F1", "parent_item_id": "DI1", "tags": [{"code":"type","list":[{"code":"type","value":"customization"}]},{"code":"parent","list":[{"code":"id","value":"CG1"}]}] },
  { "id": "C7",  "fulfillment_id": "F1", "parent_item_id": "DI1", "tags": [{"code":"type","list":[{"code":"type","value":"customization"}]},{"code":"parent","list":[{"code":"id","value":"CG2"}]}] },
  { "id": "C14", "fulfillment_id": "F1", "parent_item_id": "DI1", "tags": [{"code":"type","list":[{"code":"type","value":"customization"}]},{"code":"parent","list":[{"code":"id","value":"CG3"}]}] },
  { "id": "C16", "fulfillment_id": "F1", "parent_item_id": "DI1", "tags": [{"code":"type","list":[{"code":"type","value":"customization"}]},{"code":"parent","list":[{"code":"id","value":"CG3"}]}] },
  { "id": "I1",  "fulfillment_id": "F1", "parent_item_id": "DI2", "tags": [{"code":"type","list":[{"code":"type","value":"item"}]}] },
  { "id": "C2",  "fulfillment_id": "F1", "parent_item_id": "DI2", "tags": [{"code":"type","list":[{"code":"type","value":"customization"}]},{"code":"parent","list":[{"code":"id","value":"CG1"}]}] },
  { "id": "C7",  "fulfillment_id": "F1", "parent_item_id": "DI2", "tags": [{"code":"type","list":[{"code":"type","value":"customization"}]},{"code":"parent","list":[{"code":"id","value":"CG2"}]}] },
  { "id": "C14", "fulfillment_id": "F1", "parent_item_id": "DI2", "tags": [{"code":"type","list":[{"code":"type","value":"customization"}]},{"code":"parent","list":[{"code":"id","value":"CG3"}]}] },
  { "id": "C15", "fulfillment_id": "F1", "parent_item_id": "DI2", "tags": [{"code":"type","list":[{"code":"type","value":"customization"}]},{"code":"parent","list":[{"code":"id","value":"CG3"}]}] }
]
```

**Fulfillment**:

```json
"fulfillments": [{
  "id": "F1", "type": "Delivery",
  "@ondc/org/provider_name": "LSP or Provider Name",
  "tracking": false,
  "@ondc/org/category": "Immediate Delivery",
  "@ondc/org/TAT": "PT60M",
  "state": { "descriptor": { "code": "Serviceable" } }
}]
```

**Quote breakup** (item price + tax for each item/customization per dynamic item, plus fulfillment costs):

```json
"quote": {
  "price": { "currency": "INR", "value": "1955.65" },
  "breakup": [
    // DI1 — Farm House Pizza
    { "@ondc/org/item_id":"I1",  "@ondc/org/item_quantity":{"count":1}, "title":"Farm House Pizza",       "@ondc/org/title_type":"item", "price":{"currency":"INR","value":"269.00"}, "item":{"parent_item_id":"DI1","quantity":{"available":{"count":"99"},"maximum":{"count":"99"}},"price":{"currency":"INR","value":"269.00"},"tags":[{"code":"type","list":[{"code":"type","value":"item"}]}]} },
    { "@ondc/org/item_id":"C1",  "@ondc/org/item_quantity":{"count":1}, "title":"New Hand Tossed",         "@ondc/org/title_type":"item", "price":{"currency":"INR","value":"0.00"},   "item":{"parent_item_id":"DI1","quantity":{"available":{"count":"99"},"maximum":{"count":"99"}},"price":{"currency":"INR","value":"0.00"},  "tags":[{"code":"type","list":[{"code":"type","value":"customization"}]},{"code":"parent","list":[{"code":"id","value":"CG1"}]}]} },
    { "@ondc/org/item_id":"C7",  "@ondc/org/item_quantity":{"count":1}, "title":"Large",                   "@ondc/org/title_type":"item", "price":{"currency":"INR","value":"450.00"}, "item":{"parent_item_id":"DI1","quantity":{"available":{"count":"99"},"maximum":{"count":"99"}},"price":{"currency":"INR","value":"450.00"},"tags":[{"code":"type","list":[{"code":"type","value":"customization"}]},{"code":"parent","list":[{"code":"id","value":"CG2"}]}]} },
    { "@ondc/org/item_id":"C14", "@ondc/org/item_quantity":{"count":1}, "title":"Grilled Mushrooms",       "@ondc/org/title_type":"item", "price":{"currency":"INR","value":"80.00"},  "item":{"parent_item_id":"DI1","quantity":{"available":{"count":"99"},"maximum":{"count":"99"}},"price":{"currency":"INR","value":"80.00"}, "tags":[{"code":"type","list":[{"code":"type","value":"customization"}]},{"code":"parent","list":[{"code":"id","value":"CG3"}]}]} },
    { "@ondc/org/item_id":"C16", "@ondc/org/item_quantity":{"count":1}, "title":"Pepper Barbeque Chicken", "@ondc/org/title_type":"item", "price":{"currency":"INR","value":"95.00"},  "item":{"parent_item_id":"DI1","quantity":{"available":{"count":"99"},"maximum":{"count":"99"}},"price":{"currency":"INR","value":"95.00"}, "tags":[{"code":"type","list":[{"code":"type","value":"customization"}]},{"code":"parent","list":[{"code":"id","value":"CG3"}]}]} },
    // Tax for DI1 components
    { "@ondc/org/item_id":"I1",  "title":"Tax", "@ondc/org/title_type":"tax", "price":{"currency":"INR","value":"13.45"}, "item":{"parent_item_id":"DI1","tags":[{"code":"type","list":[{"code":"type","value":"item"}]}]} },
    { "@ondc/org/item_id":"C1",  "title":"Tax", "@ondc/org/title_type":"tax", "price":{"currency":"INR","value":"0.00"},  "item":{"parent_item_id":"DI1","tags":[{"code":"type","list":[{"code":"type","value":"customization"}]},{"code":"parent","list":[{"code":"id","value":"CG1"}]}]} },
    { "@ondc/org/item_id":"C7",  "title":"Tax", "@ondc/org/title_type":"tax", "price":{"currency":"INR","value":"22.50"}, "item":{"parent_item_id":"DI1","tags":[{"code":"type","list":[{"code":"type","value":"customization"}]},{"code":"parent","list":[{"code":"id","value":"CG2"}]}]} },
    { "@ondc/org/item_id":"C14", "title":"Tax", "@ondc/org/title_type":"tax", "price":{"currency":"INR","value":"4.00"},  "item":{"parent_item_id":"DI1","tags":[{"code":"type","list":[{"code":"type","value":"customization"}]},{"code":"parent","list":[{"code":"id","value":"CG3"}]}]} },
    { "@ondc/org/item_id":"C16", "title":"Tax", "@ondc/org/title_type":"tax", "price":{"currency":"INR","value":"4.75"},  "item":{"parent_item_id":"DI1","tags":[{"code":"type","list":[{"code":"type","value":"customization"}]},{"code":"parent","list":[{"code":"id","value":"CG3"}]}]} },
    // DI2 — Farm House Pizza (different crust + toppings)
    { "@ondc/org/item_id":"I1",  "@ondc/org/item_quantity":{"count":1}, "title":"Farm House Pizza",    "@ondc/org/title_type":"item", "price":{"currency":"INR","value":"269.00"}, "item":{"parent_item_id":"DI2","quantity":{"available":{"count":"99"},"maximum":{"count":"99"}},"price":{"currency":"INR","value":"269.00"},"tags":[{"code":"type","list":[{"code":"type","value":"item"}]}]} },
    { "@ondc/org/item_id":"C2",  "@ondc/org/item_quantity":{"count":1}, "title":"100% Wheat Thin Crust","@ondc/org/title_type":"item", "price":{"currency":"INR","value":"0.00"},  "item":{"parent_item_id":"DI2","quantity":{"available":{"count":"99"},"maximum":{"count":"99"}},"price":{"currency":"INR","value":"0.00"}, "tags":[{"code":"type","list":[{"code":"type","value":"customization"}]},{"code":"parent","list":[{"code":"id","value":"CG1"}]}]} },
    { "@ondc/org/item_id":"C7",  "@ondc/org/item_quantity":{"count":1}, "title":"Large",               "@ondc/org/title_type":"item", "price":{"currency":"INR","value":"450.00"},"item":{"parent_item_id":"DI2","quantity":{"available":{"count":"99"},"maximum":{"count":"99"}},"price":{"currency":"INR","value":"450.00"},"tags":[{"code":"type","list":[{"code":"type","value":"customization"}]},{"code":"parent","list":[{"code":"id","value":"CG2"}]}]} },
    { "@ondc/org/item_id":"C14", "@ondc/org/item_quantity":{"count":1}, "title":"Grilled Mushrooms",   "@ondc/org/title_type":"item", "price":{"currency":"INR","value":"80.00"}, "item":{"parent_item_id":"DI2","quantity":{"available":{"count":"99"},"maximum":{"count":"99"}},"price":{"currency":"INR","value":"80.00"}, "tags":[{"code":"type","list":[{"code":"type","value":"customization"}]},{"code":"parent","list":[{"code":"id","value":"CG3"}]}]} },
    { "@ondc/org/item_id":"C15", "@ondc/org/item_quantity":{"count":1}, "title":"Fresh Tomato",        "@ondc/org/title_type":"item", "price":{"currency":"INR","value":"80.00"}, "item":{"parent_item_id":"DI2","quantity":{"available":{"count":"99"},"maximum":{"count":"99"}},"price":{"currency":"INR","value":"80.00"}, "tags":[{"code":"type","list":[{"code":"type","value":"customization"}]},{"code":"parent","list":[{"code":"id","value":"CG3"}]}]} },
    // Tax for DI2 components
    { "@ondc/org/item_id":"I1",  "title":"Tax", "@ondc/org/title_type":"tax", "price":{"currency":"INR","value":"13.45"}, "item":{"parent_item_id":"DI2","tags":[{"code":"type","list":[{"code":"type","value":"item"}]}]} },
    { "@ondc/org/item_id":"C2",  "title":"Tax", "@ondc/org/title_type":"tax", "price":{"currency":"INR","value":"22.50"}, "item":{"parent_item_id":"DI2","tags":[{"code":"type","list":[{"code":"type","value":"customization"}]},{"code":"parent","list":[{"code":"id","value":"CG1"}]}]} },
    { "@ondc/org/item_id":"C7",  "title":"Tax", "@ondc/org/title_type":"tax", "price":{"currency":"INR","value":"22.50"}, "item":{"parent_item_id":"DI2","tags":[{"code":"type","list":[{"code":"type","value":"customization"}]},{"code":"parent","list":[{"code":"id","value":"CG2"}]}]} },
    { "@ondc/org/item_id":"C14", "title":"Tax", "@ondc/org/title_type":"tax", "price":{"currency":"INR","value":"4.00"},  "item":{"parent_item_id":"DI2","tags":[{"code":"type","list":[{"code":"type","value":"customization"}]},{"code":"parent","list":[{"code":"id","value":"CG3"}]}]} },
    { "@ondc/org/item_id":"C15", "title":"Tax", "@ondc/org/title_type":"tax", "price":{"currency":"INR","value":"4.00"},  "item":{"parent_item_id":"DI2","tags":[{"code":"type","list":[{"code":"type","value":"customization"}]},{"code":"parent","list":[{"code":"id","value":"CG3"}]}]} },
    // Fulfillment costs (applied once, not per dynamic item)
    { "@ondc/org/item_id":"F1", "title":"Delivery charges", "@ondc/org/title_type":"delivery", "price":{"currency":"INR","value":"50.00"} },
    { "@ondc/org/item_id":"F1", "title":"Tax",              "@ondc/org/title_type":"tax",      "price":{"currency":"INR","value":"9.00"}, "item":{"tags":[{"code":"quote","list":[{"code":"type","value":"fulfillment"}]}]} },
    { "@ondc/org/item_id":"F1", "title":"Packing charges",  "@ondc/org/title_type":"packing",  "price":{"currency":"INR","value":"25.00"} },
    { "@ondc/org/item_id":"F1", "title":"Convenience Fee",  "@ondc/org/title_type":"misc",     "price":{"currency":"INR","value":"10.00"} }
  ],
  "ttl": "PT1H"
}
```

### 5.5 Offers in Quote

Offers appear as breakup entries with `@ondc/org/title_type: "offer"`.

**Order-level discount (auto-applied)**:

```json
{
  "@ondc/org/item_id": "T2",
  "title": "Flat discount of ₹150 on minimum cart value of ₹499",
  "@ondc/org/title_type": "offer",
  "price": { "currency": "INR", "value": "-150.00" },
  "item": {
    "tags": [
      { "code": "quote", "list": [{ "code": "type", "value": "order" }] },
      {
        "code": "offer",
        "list": [
          { "code": "id", "value": "FLAT150" },
          { "code": "type", "value": "discount" },
          { "code": "auto", "value": "yes" },
          { "code": "additive", "value": "no" },
          { "code": "item_id", "value": "" },
          { "code": "item_value", "value": "" },
          { "code": "item_count", "value": "" }
        ]
      }
    ]
  }
}
```

**Fulfillment-level offer (free delivery)**:

```json
{
  "@ondc/org/item_id": "F1",
  "title": "Free delivery",
  "@ondc/org/title_type": "offer",
  "price": { "currency": "INR", "value": "-50.00" },
  "item": {
    "tags": [
      { "code": "quote", "list": [{ "code": "type", "value": "fulfillment" }] },
      {
        "code": "offer",
        "list": [
          { "code": "id", "value": "FREEDELIVERY" },
          { "code": "type", "value": "delivery" },
          { "code": "auto", "value": "yes" },
          { "code": "additive", "value": "yes" }
        ]
      }
    ]
  }
}
```

**Item-level freebie offer (Buy2Get3)**:

```json
{
  "@ondc/org/item_id": "T2",
  "@ondc/org/item_quantity": { "count": 1 },
  "title": "Buy 2 Veg Pizzas, get the 3rd for free",
  "@ondc/org/title_type": "offer",
  "price": { "currency": "INR", "value": "0.00" },
  "item": {
    "quantity": {
      "available": { "count": "99" },
      "maximum": { "count": "99" }
    },
    "price": { "currency": "INR", "value": "0.00" },
    "tags": [
      { "code": "quote", "list": [{ "code": "type", "value": "item" }] },
      {
        "code": "offer",
        "list": [
          { "code": "id", "value": "BUY2GET3" },
          { "code": "type", "value": "freebie" },
          { "code": "auto", "value": "yes" },
          { "code": "additive", "value": "no" },
          { "code": "item_id", "value": "I1" },
          { "code": "item_value", "value": "600.00" },
          { "code": "item_count", "value": "1" }
        ]
      }
    ]
  }
}
```

### 5.6 Multiple Fulfillment Types (Delivery + Self-Pickup + Buyer-Delivery)

BPP returns ALL available fulfillment options; quote includes costs for ALL types.
BAP extracts cost only for the item's default fulfillment (assigned via `items[].fulfillment_id`).

```json
"fulfillments": [
  {
    "id": "F1", "type": "Delivery",
    "@ondc/org/provider_name": "LSP or Provider Name", "tracking": false,
    "@ondc/org/category": "Immediate Delivery", "@ondc/org/TAT": "PT60M",
    "state": { "descriptor": { "code": "Serviceable" } }
  },
  {
    "id": "F2", "type": "Self-Pickup",
    "@ondc/org/provider_name": "", "tracking": false,
    "@ondc/org/category": "Takeaway", "@ondc/org/TAT": "PT15M",
    "state": { "descriptor": { "code": "Serviceable" } }
  },
  {
    "id": "F3", "type": "Buyer-Delivery",
    "@ondc/org/provider_name": "", "tracking": false,
    "@ondc/org/category": "", "@ondc/org/TAT": "PT15M",
    "state": { "descriptor": { "code": "Serviceable" } },
    "tags": [
      { "code": "weight",  "list": [{ "code": "unit", "value": "kilogram" },   { "code": "value", "value": "1" }] },
      { "code": "length",  "list": [{ "code": "unit", "value": "centimeter" }, { "code": "value", "value": "1" }] },
      { "code": "breadth", "list": [{ "code": "unit", "value": "centimeter" }, { "code": "value", "value": "1" }] },
      { "code": "height",  "list": [{ "code": "unit", "value": "centimeter" }, { "code": "value", "value": "1" }] }
    ]
  }
]
```

Quote includes fulfillment cost lines for F1, F2, F3 — BAP shows only the buyer's chosen type.

### 5.7 Slotted Delivery / Pickup

BPP may return multiple fulfillment options with time slots:

```json
"fulfillments": [
  {
    "id": "F1", "type": "Delivery",
    "@ondc/org/provider_name": "Provider Name", "tracking": false,
    "@ondc/org/category": "Immediate Delivery", "@ondc/org/TAT": "PT60M",
    "state": { "descriptor": { "code": "Serviceable" } },
    "end": { "time": { "range": { "start": "2023-06-03T09:30:00.000Z", "end": "2023-06-03T10:00:00.000Z" } } }
  },
  {
    "id": "F2", "type": "Delivery",
    "@ondc/org/provider_name": "Provider Name", "tracking": true,
    "@ondc/org/category": "Immediate Delivery", "@ondc/org/TAT": "PT90M",
    "state": { "descriptor": { "code": "Serviceable" } },
    "end": { "time": { "range": { "start": "2023-06-03T10:30:00.000Z", "end": "2023-06-03T11:00:00.000Z" } } }
  },
  {
    "id": "F3", "type": "Self-Pickup",
    "@ondc/org/provider_name": "", "tracking": false,
    "@ondc/org/category": "Takeaway", "@ondc/org/TAT": "PT30M",
    "state": { "descriptor": { "code": "Serviceable" } },
    "start": { "time": { "range": { "start": "2023-06-03T09:15:00.000Z", "end": "2023-06-03T09:30:00.000Z" } } }
  },
  {
    "id": "F4", "type": "Self-Pickup",
    "@ondc/org/provider_name": "", "tracking": false,
    "@ondc/org/category": "Kerbside", "@ondc/org/TAT": "PT15M",
    "state": { "descriptor": { "code": "Serviceable" } },
    "start": { "time": { "range": { "start": "2023-06-03T10:30:00.000Z", "end": "2023-06-03T10:45:00.000Z" } } }
  }
]
```

---

## 6. Enum Reference Tables

### Fulfillment `state.descriptor.code`

| Value             | Meaning                                                       |
| ----------------- | ------------------------------------------------------------- |
| `Serviceable`     | Buyer location is serviceable, item available                 |
| `Non-serviceable` | Buyer/seller location not serviceable or merchant unavailable |

### Fulfillment `type`

| Value                      | Use                                                          |
| -------------------------- | ------------------------------------------------------------ |
| `Delivery`                 | Standard door delivery                                       |
| `Self-Pickup`              | Customer collects from store                                 |
| `Buyer-Delivery`           | BAP-arranged logistics                                       |
| `Delivery and Self-Pickup` | Used in catalog (`/on_search`) for provider-level definition |

### Fulfillment `@ondc/org/category`

| Value                | Description                                         |
| -------------------- | --------------------------------------------------- |
| `Immediate Delivery` | Express/on-demand delivery                          |
| `Takeaway`           | Self-pickup at store                                |
| `Kerbside`           | Kerbside pickup                                     |
| `""` (empty)         | Non-serviceable, or Buyer-Delivery without category |

### Quote `@ondc/org/title_type`

| Value      | What it covers                    | Quote level (via `quote.type` tag) |
| ---------- | --------------------------------- | ---------------------------------- |
| `item`     | Item / customization price        | item                               |
| `delivery` | Delivery charge                   | fulfillment                        |
| `tax`      | Tax on item or fulfillment        | item, fulfillment                  |
| `packing`  | Packing charge                    | fulfillment                        |
| `discount` | Discount amount (negative)        | item, fulfillment, order           |
| `misc`     | Misc fees (convenience fee, etc.) | fulfillment, order                 |
| `offer`    | Applied offer (may be negative)   | item, fulfillment, order           |

### Quote level `type` tag (inside `item.tags[code="quote"]`)

| Value         | Meaning                                     |
| ------------- | ------------------------------------------- |
| `item`        | Tax/offer applied at item level             |
| `fulfillment` | Tax/offer/cost applied at fulfillment level |
| `order`       | Offer/discount applied at order level       |

### Offer tag `code` values (inside `item.tags[code="offer"]`)

| Sub-code     | Values                            | Meaning                                        |
| ------------ | --------------------------------- | ---------------------------------------------- |
| `id`         | string                            | Offer ID from catalog                          |
| `type`       | `discount`, `delivery`, `freebie` | Offer type                                     |
| `auto`       | `yes`, `no`                       | Auto-applied vs opt-in                         |
| `additive`   | `yes`, `no`                       | Whether additive with other offers             |
| `item_id`    | string                            | Item ID for freebie (empty for non-freebie)    |
| `item_value` | string                            | Value of freebie item (empty for non-freebie)  |
| `item_count` | string                            | Count of freebie items (empty for non-freebie) |

### Payment `type` (in `/select` request)

| Value              | Meaning                              |
| ------------------ | ------------------------------------ |
| `ON-FULFILLMENT`   | Cash/card on delivery                |
| `ON-ORDER`         | Prepaid (buyer pays before delivery) |
| `PRE-FULFILLMENT`  | Pay before fulfillment starts        |
| `POST-FULFILLMENT` | Pay after delivery                   |

---

## 7. Quote Validation Rules (BAP must enforce)

When processing an incoming `/on_select`:

1. **Checksum**: `quote.price.value` must equal the sum of all `quote.breakup[].price.value` (with sign — discounts are negative). NACK with `22507` if mismatch.

2. **Item total**: For each item with `title_type="item"`, the total breakup price must equal `item.price.value × @ondc/org/item_quantity.count`. NACK with `22507` if mismatch.

3. **Quantity reduced**: If `@ondc/org/item_quantity.count` < requested count in `/select`, the BPP is signalling partial stock. If `count = 0`, item is out of stock.

4. **Error-quantity alignment**: If `error.code = "40002"` is present and `error.message` is a stringified JSON array, each entry must reference an item whose quote quantity is 0. If the list in `error.message` does not match the items with `count = 0` in the breakup, BAP **should** NACK with error code `22507`.

5. **Price precision**: All prices may have up to 2 decimal digits.

6. **Quote TTL**: Check `quote.ttl`. If TTL has expired before the buyer proceeds to `/init`, call `/select` again.

7. **Serviceability check**: Check each fulfillment's `state.descriptor.code`:
   - `"Serviceable"` → proceed
   - `"Non-serviceable"` → show error to buyer (do not proceed to `/init`)

8. **Non-serviceable with error 30009**: BPP may not include full breakup for non-serviceable responses. Do not attempt to display a quote to the buyer.

9. **Min order value (30023)**: If error code is `30023`, prompt buyer to increase cart value to meet minimum. Do not NACK — this is an informational error for the buyer UI.

10. **Fulfillment default**: The items array in `/on_select` has `fulfillment_id` assigned. Use this to determine which fulfillment type's costs to show to the buyer as default. When buyer switches fulfillment type, that changes the quote — re-call `/select` or apply the delta from the multi-fulfillment quote.

11. **Updated provider location**: If `provider.locations[0].id` in `/on_select` differs from what was sent in `/select`, BPP is redirecting fulfillment to a different store. Show a message to buyer and use the updated location in `/init`.

12. **Quote not frozen**: Quote from `/on_select` is provisional. Do not lock the price until `/on_init`. If BPP changes the quote in `/on_init`, BAP must validate the new quote. If cart changed (items or quantity), call `/select` again.

---

## 8. Error Codes

| Code    | Direction                           | When                                                                   |
| ------- | ----------------------------------- | ---------------------------------------------------------------------- |
| `30009` | BPP→BAP in `/on_select`             | Buyer/seller location non-serviceable, or merchant unavailable         |
| `40002` | BPP→BAP in `/on_select`             | Item out of stock (may appear with partial quote showing `count:0`)    |
| `30023` | BPP→BAP in `/on_select`             | Cart value below minimum order value                                   |
| `22507` | BAP NACKs `/on_select`              | `error.message` item list doesn't match zero-quantity items in breakup |
| `30006` | BPP→BAP in `/on_init`/`/on_confirm` | Offer in cart is no longer valid                                       |
| `30007` | BPP→BAP                             | Offer valid but fulfillment impossible (e.g. freebie item unavailable) |

**Error message format for multi-item stock issues** (error.code=40002, error.message = stringified JSON):

```json
"[{\"dynamic_item_id\":\"DI1\",\"item_id\":\"I1\",\"error\":\"40002\"}, {\"dynamic_item_id\":\"DI2\",\"customization_id\":\"C15\",\"customization_group_id\":\"CG3\",\"error\":\"40002\"}]"
```

---

## 9. Dynamic Item ID — F&B CG Contract

### Concept

In F&B, the buyer can order the same base item twice with different customizations (e.g. two pizzas with different toppings). ONDC uses **dynamic item IDs** (`parent_item_id`) to group each order line:

```
DI1 (dynamic group 1):
  ├── I1  (base item: Farm House Pizza)      — tag type: "item"
  ├── C1  (crust: New Hand Tossed)           — tag type: "customization", parent: CG1
  ├── C7  (size: Large)                      — tag type: "customization", parent: CG2
  ├── C14 (topping: Grilled Mushrooms)       — tag type: "customization", parent: CG3
  └── C16 (topping: Pepper BBQ Chicken)      — tag type: "customization", parent: CG3

DI2 (dynamic group 2):
  ├── I1  (base item: Farm House Pizza)      — same base item, different customizations
  ├── C2  (crust: 100% Wheat Thin Crust)    — tag type: "customization", parent: CG1
  ├── C7  (size: Large)                      — same customization as DI1
  ├── C14 (topping: Grilled Mushrooms)       — same customization as DI1
  └── C15 (topping: Fresh Tomato)            — tag type: "customization", parent: CG3
```

### BAP Responsibilities

1. **Generate dynamic IDs** — BAP creates DI1, DI2… etc. These IDs exist only within a single transaction.

2. **Validate CG constraints before sending /select**:
   - For each base item with `custom_group` tag, identify all mandatory CGs (from catalog `@ondc/org/CG` where `min > 0`)
   - Every mandatory CG must have exactly one customization selected (unless CG allows multiple per `max`)
   - If CG `min = 0`, the customization group is optional — BAP may or may not include a selection

3. **Group correctly** — every item in a dynamic group must share the same `parent_item_id`. The base item has `tag type: "item"`, every customization has `tag type: "customization"` plus `tag parent.id: <CG_ID>`.

4. **Quantity**: Each customization has `quantity.count = 1` unless the CG allows multi-select (some toppings allow multiple).

5. **Out-of-stock customization handling**:
   - If a **mandatory** customization is out of stock → prompt buyer to select a different customization from the same CG (matching veg/non-veg/egg type)
   - If an **optional** customization is out of stock → BPP returns available quantity in quote; BAP adjusts the selection but keeps base item

---

## 10. BAP Processing Algorithm for /on_select

```
receive /on_select webhook
│
├─ 1. Verify Ed25519 signature (via Registry public key lookup)
│      NACK 401 if missing/invalid Authorization header
│
├─ 2. Validate context
│      action == "on_select" AND bpp_id present AND message_id present
│      NACK 200 with DOMAIN-ERROR 20000 if invalid
│
├─ 3. ACK immediately (200 OK with ACK)
│
└─ 4. Async processing:
   │
   ├─ 4a. Correlate with pending /select request
   │       match by transaction_id + message_id
   │       if no pending /select found → log and discard (could be stale)
   │
   ├─ 4b. Check error field
   │       error.code == "30009" → mark order session as non-serviceable → notify buyer
   │       error.code == "30023" → mark order session with min-order error → notify buyer
   │       error.code == "40002" → proceed to stock check below
   │
   ├─ 4c. Check serviceability
   │       for each fulfillment: state.descriptor.code == "Non-serviceable" → no-go
   │
   ├─ 4d. Stock validation
   │       for each breakup entry with title_type="item":
   │         if item.quantity.available.count == "0" → item is out of stock
   │         if count < requested → partial stock; prompt buyer
   │
   ├─ 4e. Quote integrity check
   │       Σ breakup[].price.value (accounting for sign) == quote.price.value
   │       for each item breakup: item.price.value × item_quantity.count == price.value
   │       if mismatch → NACK /on_select with 22507 (via a new /select with NACK response)
   │       Note: BAP does not directly NACK /on_select after ACK — log the discrepancy,
   │             refuse to display quote to buyer, and re-call /select if needed
   │
   ├─ 4f. Error message alignment (when error.code == 40002)
   │       parse error.message as JSON array
   │       verify each entry matches a zero-quantity item in breakup
   │       if mismatch → flag 22507 discrepancy
   │
   ├─ 4g. Check quote TTL
   │       parse quote.ttl (ISO8601 duration) → compute expiry = on_select.timestamp + ttl
   │       store expiry alongside quote; re-call /select if expired before /init
   │
   ├─ 4h. Check provider location update
   │       if provider.locations[0].id != location sent in /select → store updated location
   │       notify buyer that delivery will be from a different store
   │
   ├─ 4i. Store quote + fulfillment options
   │       persist quote (all breakup lines), fulfillment options, item-fulfillment mapping,
   │       quote TTL expiry in order session store (Redis/DB keyed by transaction_id)
   │
   └─ 4j. Notify buyer
           render quote with default fulfillment costs
           show all fulfillment options (Delivery slots, Self-Pickup, Buyer-Delivery)
           if out-of-stock customizations: prompt for alternative selection
           if offer applied: show discount line
```
