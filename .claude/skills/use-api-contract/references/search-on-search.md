# ONDC F&B — /search and /on_search Reference

Authoritative specification for `/search` and `/on_search` for F&B (ONDC:RET11), extracted
from ONDC API Contract for Retail v1.2.0. Use this for implementing catalog fetch, ingestion,
and incremental refresh in the Buyer NP.

---

## Table of Contents

1. [/search — Payload Variants](#1-search--payload-variants)
   - 1a. Full catalog refresh (F&B)
   - 1b. Full catalog — downloadable link
   - 1c. Search by item name
   - 1d. Search by delivery location
   - 1e. Incremental refresh — pull (one-time)
   - 1f. Incremental refresh — push (subscribe)
   - 1g. Stop incremental refresh
2. [/on_search — F&B Catalog Schema](#2-on_search--fb-catalog-schema)
   - 2a. Context
   - 2b. bpp/descriptor + bpp_terms
   - 2c. bpp/fulfillments
   - 2d. Provider structure
   - 2e. Locations
   - 2f. Categories (custom_menu + custom_group)
   - 2g. Items — base item
   - 2h. Items — customization item
   - 2i. Provider-level tags (timing, serviceability, order_value)
   - 2j. Offers
3. [Enum Reference](#3-enum-reference)
4. [Strict Schema Validation Rules](#4-strict-schema-validation-rules)
5. [Incremental on_search — ACK/NACK Rules](#5-incremental-on_search--acknack-rules)
6. [Catalog Ingestion Logic](#6-catalog-ingestion-logic)

---

## 1. /search — Payload Variants

All /search requests share this required structure:
- `context.domain = "ONDC:RET11"` for F&B
- `context.action = "search"`
- `context.ttl = "PT30S"` (standard; adjust as needed)
- `message.intent.payment` with finder fee (required)
- `message.intent.tags` with `bap_terms` (required)
- `bpp_id` and `bpp_uri` are **empty** in search (filled by gateway routing)

### 1a. Full catalog refresh — F&B (by city)

The standard catalog refresh. For F&B, do NOT include `category.id` — search by city only.

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
        "end": {
          "location": {
            "gps": "12.974002,77.613458",
            "address": { "area_code": "560001" }
          }
        }
      },
      "payment": {
        "@ondc/org/buyer_app_finder_fee_type": "percent",
        "@ondc/org/buyer_app_finder_fee_amount": "3"
      },
      "tags": [
        {
          "code": "bap_terms",
          "list": [
            { "code": "static_terms", "value": "" },
            { "code": "static_terms_new", "value": "https://github.com/ONDC-Official/NP-Static-Terms/buyerNP_BNP/1.0/tc.pdf" },
            { "code": "effective_date", "value": "2023-10-01T00:00:00.000Z" }
          ]
        }
      ]
    }
  }
}
```

**Key F&B rule**: Do NOT send `category.id` in F&B search. Unlike Grocery (RET10) which can
filter by sub-category (e.g. `"Foodgrains"`), F&B search is city-level only because F&B category
hierarchy is inconsistent across merchants.

### 1b. Full catalog — request as downloadable link

When BAP wants a download link instead of inline JSON (useful for large catalogs):

```json
{
  "message": {
    "intent": {
      "payment": { ... },
      "tags": [
        {
          "code": "catalog_full",
          "list": [{ "code": "payload_type", "value": "link" }]
        },
        { "code": "bap_terms", "list": [ ... ] }
      ]
    }
  }
}
```

BPP will return `catalog_link` tag in the provider with a time-limited URL to download
the catalog as a ZIP file.

### 1c. Search by item name (live search)

For live search where buyer typed a query:

```json
{
  "message": {
    "intent": {
      "item": {
        "descriptor": { "name": "pizza" }
      },
      "fulfillment": {
        "type": "Delivery",
        "end": {
          "location": {
            "gps": "12.974002,77.613458",
            "address": { "area_code": "560001" }
          }
        }
      },
      "payment": { ... },
      "tags": [ { "code": "bap_terms", ... } ]
    }
  }
}
```

### 1d. Search by delivery end location (serviceability-filtered)

Standard for F&B where you want only stores that can deliver to the buyer's location:

```json
{
  "message": {
    "intent": {
      "fulfillment": {
        "type": "Delivery",
        "end": {
          "location": {
            "gps": "12.974002,77.613458",
            "address": { "area_code": "560001" }
          }
        }
      },
      "payment": { ... },
      "tags": [ { "code": "bap_terms", ... } ]
    }
  }
}
```

### 1e. Incremental refresh — pull (one-time, specific time range)

Request updates from `start_time` to `end_time` in a single response. Both must be past timestamps.

```json
{
  "context": {
    "domain": "ONDC:RET11",
    "action": "search",
    "city": "*",
    "transaction_id": "T1",
    "message_id": "M1",
    "timestamp": "2023-06-03T09:00:00.000Z",
    "ttl": "PT30S"
    ...
  },
  "message": {
    "intent": {
      "payment": { ... },
      "tags": [
        {
          "code": "catalog_inc",
          "list": [
            { "code": "start_time", "value": "2023-06-03T08:00:00.000Z" },
            { "code": "end_time", "value": "2023-06-03T09:00:00.000Z" }
          ]
        },
        { "code": "bap_terms", "list": [ ... ] }
      ]
    }
  }
}
```

Rule: `start_time < context.timestamp`, `end_time < context.timestamp`, `end_time > start_time`

### 1f. Incremental refresh — push (subscribe, continuous)

Request BPP to push deltas continuously from `start_time` until stopped:

```json
{
  "context": {
    "city": "*",
    "transaction_id": "T_INC_001",
    ...
  },
  "message": {
    "intent": {
      "payment": { ... },
      "tags": [
        {
          "code": "catalog_inc",
          "list": [
            { "code": "mode", "value": "start" },
            { "code": "start_time", "value": "2023-06-03T08:00:00.000Z" }
          ]
        },
        { "code": "bap_terms", "list": [ ... ] }
      ]
    }
  }
}
```

- If `start_time` is omitted, defaults to `context.timestamp`
- BPP pushes aggregated updates every 1–30 minutes (BPP's discretion)
- Response: `solicited` (same `transaction_id` + `message_id`) or `unsolicited` (same `transaction_id`, different `message_id`)

### 1g. Stop incremental refresh

Must use the **same `transaction_id`** as the start request:

```json
{
  "context": {
    "transaction_id": "T_INC_001",
    "message_id": "M_STOP_001",
    ...
  },
  "message": {
    "intent": {
      "payment": { ... },
      "tags": [
        {
          "code": "catalog_inc",
          "list": [{ "code": "mode", "value": "stop" }]
        }
      ]
    }
  }
}
```

**Important**: Only 1 open incremental request per BAP at any time. Stop the current one
before starting a new incremental subscription.

---

## 2. /on_search — F&B Catalog Schema

This is the authoritative F&B catalog structure the BPP sends. Every field documented here
is required unless explicitly marked `[optional]`.

### 2a. Context

```json
{
  "context": {
    "domain": "ONDC:RET11",
    "country": "IND",
    "city": "std:080",
    "action": "on_search",
    "core_version": "1.2.0",
    "bap_id": "buyerNP.com",
    "bap_uri": "https://buyerNP.com/ondc",
    "bpp_id": "sellerNP.com",
    "bpp_uri": "https://sellerNP.com/ondc",
    "transaction_id": "T1",
    "message_id": "M1",
    "timestamp": "2023-06-03T08:00:30.000Z"
  }
}
```

Note: `on_search` has no `ttl` in context (only request-side actions use `ttl`).

### 2b. bpp/descriptor + bpp_terms

Top-level Seller NP descriptor. The `bpp_terms` tag is mandatory and controls behavior:

```json
"bpp/descriptor": {
  "name": "Seller NP",
  "symbol": "https://...",
  "short_desc": "...",
  "long_desc": "...",
  "images": ["https://..."],
  "tags": [
    {
      "code": "bpp_terms",
      "list": [
        { "code": "np_type", "value": "ISN" },         // ISN or MSN
        { "code": "accept_bap_terms", "value": "Y" },  // Y or N
        { "code": "collect_payment", "value": "Y" }    // Y or N
      ]
    }
  ]
}
```

**`np_type` enum**: `"ISN"` (Inventory Seller Node — single seller), `"MSN"` (Marketplace Seller Node — aggregates multiple sellers)

**`collect_payment`**: If `"Y"`, BPP collects payment via payment link in `/on_init`. BAP must render that link.

### 2c. bpp/fulfillments

NP-level fulfillment types (not provider-level):

```json
"bpp/fulfillments": [
  { "id": "1", "type": "Delivery" },
  { "id": "2", "type": "Self-Pickup" },
  { "id": "3", "type": "Delivery and Self-Pickup" }
]
```

**`type` enum**: `"Delivery"`, `"Self-Pickup"`, `"Delivery and Self-Pickup"`, `"Buyer-Delivery"`

### 2d. Provider structure (top-level)

```json
{
  "id": "P1",
  "time": {
    "label": "enable",            // "enable" or "disable"
    "timestamp": "2023-06-03T07:00:00.000Z"   // catalog version timestamp
  },
  "descriptor": {
    "name": "Store 1",
    "symbol": "https://...",
    "short_desc": "...",
    "long_desc": "...",
    "images": ["https://..."]
  },
  "@ondc/org/fssai_license_no": "12345678901234",   // MANDATORY for F&B, 14-digit
  "ttl": "P1D",                 // ISO 8601 duration — how long to cache this provider
  "fulfillments": [ ... ],       // provider-level fulfillment types
  "locations": [ ... ],
  "categories": [ ... ],         // custom_menu and custom_group definitions
  "items": [ ... ],
  "offers": [ ... ],             // [optional]
  "tags": [ ... ]                // timing, serviceability, order_value tags
}
```

**`time.label` enum**: `"enable"` (provider active), `"disable"` (provider disabled — stop serving)

**Provider `ttl`**: How long BAP should cache this provider's catalog. Typically `"P1D"` (1 day).
Re-fetch when expired or when incremental refresh indicates a change.

### 2e. Locations

```json
{
  "id": "L1",
  "time": {
    "label": "enable",
    "timestamp": "2023-06-03T07:30:30.000Z",
    "days": "1,2,3,4,5,6,7",    // comma-separated day numbers 1=Mon, 7=Sun
    "schedule": {
      "holidays": ["2023-08-15"],  // ISO date strings
      "frequency": "PT4H",         // [optional] how often it opens
      "times": ["1100", "1900"]    // [optional] opening times in HHMM
    },
    "range": {
      "start": "1100",   // HHMM format
      "end": "2100"
    }
  },
  "gps": "12.967555,77.749666",    // lat,lng
  "address": {
    "locality": "Jayanagar",
    "street": "Jayanagar 4th Block",
    "city": "Bengaluru",
    "area_code": "560076",
    "state": "KA"
  },
  "circle": {                      // [optional] legacy serviceability radius
    "gps": "12.967555,77.749666",
    "radius": { "unit": "km", "value": "3" }
  }
}
```

**`time.label` enum**: `"enable"` or `"disable"`

**`days` format**: Comma-separated integers 1–7 (1=Monday, 7=Sunday)

**`time.range.start/end` format**: 4-digit HHMM string (e.g. `"0900"`, `"2130"`)

### 2f. Categories — custom_menu and custom_group

Categories serve two distinct purposes in F&B, distinguished by their `type` tag:

#### Custom menu (navigation/display hierarchy)

```json
{
  "id": "5",
  "parent_category_id": "",       // [optional] for nested menus
  "descriptor": {
    "name": "Pizza",
    "short_desc": "...",
    "long_desc": "...",
    "images": ["https://..."]
  },
  "tags": [
    { "code": "type", "list": [{ "code": "type", "value": "custom_menu" }] },
    {
      "code": "timing",
      "list": [
        { "code": "day_from", "value": "1" },
        { "code": "day_to", "value": "5" },
        { "code": "time_from", "value": "1800" },
        { "code": "time_to", "value": "2200" }
      ]
    },
    { "code": "display", "list": [{ "code": "rank", "value": "3" }] }
  ]
}
```

#### Customization group (defines options for make-to-order)

```json
{
  "id": "CG1",
  "descriptor": { "name": "Crust (any 1 option)" },
  "tags": [
    { "code": "type", "list": [{ "code": "type", "value": "custom_group" }] },
    {
      "code": "config",
      "list": [
        { "code": "min", "value": "1" },       // 0 = optional, ≥1 = mandatory
        { "code": "max", "value": "1" },       // max selections allowed
        { "code": "input", "value": "select" }, // "select" or "text" (for special instructions)
        { "code": "seq", "value": "1" }        // display sequence order
      ]
    }
  ]
}
```

**`type` enum for categories**: `"custom_menu"`, `"custom_group"`, `"variant_group"`

**`config.input` enum**: `"select"` (user picks from options), `"text"` (free text, used for special instructions)

**Mandatory CG rule**: A CG with `min ≥ 1` is mandatory. If its definition is invalid or no
customizations map to it, the BAP must disable the associated base item entirely.

### 2g. Items — Base item (type: "item")

```json
{
  "id": "I1",
  "time": {
    "label": "enable",
    "timestamp": "2023-06-03T07:30:00.000Z"
  },
  "descriptor": {
    "name": "Farmhouse Pizza",
    "symbol": "https://...",
    "short_desc": "...",
    "long_desc": "...",
    "images": ["https://..."]
  },
  "quantity": {
    "unitized": {
      "measure": { "unit": "unit", "value": "1" }
    },
    "available": { "count": "99" },   // "99" means in stock; "0" means out of stock
    "maximum": { "count": "99" }
  },
  "price": {
    "currency": "INR",
    "value": "269.0",               // base price (before customizations)
    "maximum_value": "269.0",
    "tags": [                        // [optional] price range for customizable items
      {
        "code": "range",
        "list": [
          { "code": "lower", "value": "269.00" },
          { "code": "upper", "value": "304.00" }
        ]
      },
      {
        "code": "default_selection",
        "list": [
          { "code": "value", "value": "269.00" },
          { "code": "maximum_value", "value": "290.00" }
        ]
      }
    ]
  },
  "category_id": "F&B",              // fixed "F&B" for all F&B items
  "category_ids": ["5:1"],           // [optional] custom_menu assignment: "menu_id:rank"
  "fulfillment_id": "F1",
  "location_id": "L1",
  "related": false,                  // false for base items, true for customizations
  "recommended": true,               // [optional]
  "@ondc/org/returnable": false,
  "@ondc/org/cancellable": false,
  "@ondc/org/return_window": "PT1H",
  "@ondc/org/seller_pickup_return": false,
  "@ondc/org/time_to_ship": "PT45M",
  "@ondc/org/available_on_cod": false,
  "@ondc/org/contact_details_consumer_care": "Name,email@domain.com,phonenumber",
  "tags": [
    { "code": "type", "list": [{ "code": "type", "value": "item" }] },
    {
      "code": "custom_group",         // which CGs apply to this base item
      "list": [{ "code": "id", "value": "CG1" }]
      // add more entries for additional CGs: CG2, CG3...
    },
    {
      "code": "config",               // [optional] override CG config at item level
      "list": [
        { "code": "id", "value": "CG1" },
        { "code": "min", "value": "1" },
        { "code": "max", "value": "1" },
        { "code": "seq", "value": "1" }
      ]
    },
    {
      "code": "timing",               // [optional] item availability window
      "list": [
        { "code": "day_from", "value": "1" },
        { "code": "day_to", "value": "5" },
        { "code": "time_from", "value": "1800" },
        { "code": "time_to", "value": "2200" }
      ]
    },
    {
      "code": "veg_nonveg",
      "list": [{ "code": "veg", "value": "yes" }]   // "yes" or "no"
    }
  ]
}
```

**`time.label` enum for items**: `"enable"` (item active), `"disable"` (item removed/out-of-stock)

**`quantity.available.count`**: `"99"` = in stock (any positive string), `"0"` = out of stock

**`category_id`**: Always `"F&B"` for all items and customizations in F&B domain

**`category_ids` format**: `"menu_id:rank"` — assigns item to a custom_menu with a display rank

**`veg_nonveg.veg` enum**: `"yes"` (vegetarian), `"no"` (non-vegetarian)

### 2h. Items — Customization item (type: "customization")

```json
{
  "id": "C1",                        // customization item ID
  "descriptor": { "name": "New Hand Tossed" },
  "quantity": {
    "available": { "count": "99" },
    "maximum": { "count": "99" }
  },
  "price": {
    "currency": "INR",
    "value": "0.0",                  // incremental price (0 if included in base)
    "maximum_value": "0.0"
  },
  "category_id": "F&B",
  "related": true,                   // ALWAYS true for customizations
  "tags": [
    { "code": "type", "list": [{ "code": "type", "value": "customization" }] },
    {
      "code": "parent",              // which CG this option belongs to
      "list": [
        { "code": "id", "value": "CG1" },
        { "code": "default", "value": "yes" }  // "yes" = pre-selected for buyer
      ]
    },
    {
      "code": "child",               // [optional] which CG becomes available after selecting this
      "list": [{ "code": "id", "value": "CG2" }]
    },
    {
      "code": "veg_nonveg",
      "list": [{ "code": "veg", "value": "yes" }]
    }
  ]
}
```

**`parent.default` enum**: `"yes"` (pre-selected), `"no"` (not pre-selected)

**`child` tag**: Enables dependent/cascading CGs. E.g. selecting a crust type can unlock a
size group. The `child.id` is the CG that becomes active when this customization is chosen.

**Price in customizations**: Additive on top of base item price. `0.0` means included in base price.

### 2i. Provider-level tags

Provider `tags[]` array holds critical operational data:

#### Minimum order value

```json
{ "code": "order_value", "list": [{ "code": "min_value", "value": "300.00" }] }
```

#### Catalog download link (alternative to inline)

```json
{
  "code": "catalog_link",
  "list": [
    { "code": "type", "value": "inline" },          // "inline" or "link"
    { "code": "type_value", "value": "https://s3.amazon.com/..." },
    { "code": "type_validity", "value": "PT24H" },  // link validity duration
    { "code": "last_update", "value": "2023-05-21T00:00:00.000Z" }
  ]
}
```

**`catalog_link.type` enum**: `"inline"` (catalog embedded), `"link"` (downloadable URL)

#### Timing tags (provider-level order acceptance windows)

```json
{
  "code": "timing",
  "list": [
    { "code": "type", "value": "Order" },   // "Order", "Delivery", "Self-Pickup"
    { "code": "location", "value": "L1" },
    { "code": "day_from", "value": "1" },   // 1=Mon
    { "code": "day_to", "value": "5" },     // 5=Fri
    { "code": "time_from", "value": "0900" },
    { "code": "time_to", "value": "1100" }
  ]
}
```

Multiple `timing` tags for different windows (e.g. lunch + dinner slots separately).

**`timing.type` enum**: `"Order"` (order acceptance), `"Delivery"`, `"Self-Pickup"`

#### Close timing (temporary closure)

```json
{
  "code": "close_timing",
  "list": [
    { "code": "location", "value": "L1" },
    { "code": "start", "value": "2023-06-03T16:00:00.000Z" },
    { "code": "end", "value": "2023-06-03T23:59:00.000Z" }
  ]
}
```

#### Serviceability (new construct)

```json
{
  "code": "serviceability",
  "list": [
    { "code": "location", "value": "L1" },
    { "code": "category", "value": "F&B" },
    { "code": "type", "value": "10" },    // serviceability type code
    { "code": "val", "value": "3" },      // radius value
    { "code": "unit", "value": "km" }     // "km" or "pincode"
  ]
}
```

Both old (circle at location level) and new (serviceability tag) constructs must be supported
until the old construct is deprecated.

### 2j. Offers

Provider-level offers, applied to items:

```json
{
  "id": "DISCP60",
  "descriptor": {
    "code": "discount",            // offer type: "discount", "buyXgetY", "freebie"
    "images": ["https://..."]
  },
  "location_ids": ["L1"],
  "item_ids": ["I1"],             // [optional] restrict to specific items
  "time": {
    "label": "valid",
    "range": {
      "start": "2023-06-21T16:00:00.000Z",
      "end": "2023-06-21T23:00:00.000Z"
    }
  },
  "tags": [
    {
      "code": "qualifier",
      "list": [
        { "code": "min_value", "value": "159" }    // min cart value
      ]
    },
    {
      "code": "benefit",
      "list": [
        { "code": "value_type", "value": "percent" },  // "percent" or "amount"
        { "code": "value", "value": "-60.00" },         // negative = discount
        { "code": "value_cap", "value": "-120.00" }     // [optional] cap
      ]
    },
    {
      "code": "meta",
      "list": [
        { "code": "additive", "value": "no" },   // "yes" = combinable with others
        { "code": "auto", "value": "yes" }       // "yes" = auto-applied, "no" = opt-in
      ]
    }
  ]
}
```

**Offer `descriptor.code` enum**: `"discount"`, `"buyXgetY"`, `"freebie"`

**`qualifier` fields**:
- `min_value` — minimum cart value for offer to apply
- `item_count` — minimum item count in cart
- `item_id` — specific item that must be in cart

**`benefit` fields**:
- `value_type` enum: `"percent"`, `"amount"`
- `value` — negative for discounts (e.g. `"-60.00"`)
- `value_cap` — maximum discount value (e.g. `"-120.00"`)
- `item_count` — for buyXgetY/freebie: total count of items offered
- `item_id` — for buyXgetY/freebie: which item is given free
- `item_value` — actual value of the free item

**`meta.auto` enum**: `"yes"` (auto-applied at checkout), `"no"` (buyer must opt in)

---

## 3. Enum Reference

| Field path | Valid values |
|---|---|
| `context.domain` | `"ONDC:RET11"` (F&B) |
| `context.action` (on_search) | `"on_search"` |
| `bpp_terms.np_type` | `"ISN"`, `"MSN"` |
| `bpp_terms.accept_bap_terms` | `"Y"`, `"N"` |
| `bpp_terms.collect_payment` | `"Y"`, `"N"` |
| `bpp/fulfillments[].type` | `"Delivery"`, `"Self-Pickup"`, `"Delivery and Self-Pickup"`, `"Buyer-Delivery"` |
| `provider.time.label` | `"enable"`, `"disable"` |
| `location.time.label` | `"enable"`, `"disable"` |
| `item.time.label` | `"enable"`, `"disable"` |
| `category.tags[type].value` | `"custom_menu"`, `"custom_group"`, `"variant_group"` |
| `category.tags[config.input]` | `"select"`, `"text"` |
| `item.category_id` | `"F&B"` (all items in F&B) |
| `item.tags[type].value` | `"item"`, `"customization"` |
| `item.tags[veg_nonveg.veg]` | `"yes"`, `"no"` |
| `item.tags[parent.default]` | `"yes"`, `"no"` |
| `item.quantity.available.count` | `"99"` (in stock), `"0"` (out of stock), or string number |
| `provider.tags[timing.type]` | `"Order"`, `"Delivery"`, `"Self-Pickup"` |
| `offer.descriptor.code` | `"discount"`, `"buyXgetY"`, `"freebie"` |
| `offer.tags[benefit.value_type]` | `"percent"`, `"amount"` |
| `offer.tags[meta.auto]` | `"yes"`, `"no"` |
| `offer.tags[meta.additive]` | `"yes"`, `"no"` |
| `catalog_link.type` | `"inline"`, `"link"` |
| `catalog_inc.mode` | `"start"`, `"stop"` |
| `catalog_full.payload_type` | `"inline"`, `"link"` |
| `price.currency` | `"INR"` |
| `location.circle.radius.unit` | `"km"` |
| `days` format | `"1,2,3,4,5,6,7"` (1=Mon, 7=Sun) |
| Time format (HHMM) | 4-digit string e.g. `"0900"`, `"2130"` |

---

## 4. Strict Schema Validation Rules

These rules must be enforced when ingesting any `/on_search` response. Violations indicate
a malformed catalog from the BPP — log them and handle gracefully.

### Context validation

```
✓ context.domain == "ONDC:RET11"
✓ context.action == "on_search"
✓ context.core_version == "1.2.0"
✓ context.bap_id matches our own bap_id
✓ context.bpp_id is present and non-empty
✓ context.bpp_uri is present and non-empty
✓ context.transaction_id matches an open /search request
✓ context.message_id is unique (idempotency check)
✓ context.timestamp is a valid ISO 8601 datetime
```

### bpp/descriptor validation

```
✓ bpp/descriptor.tags contains "bpp_terms" tag
✓ bpp_terms has "np_type" with value "ISN" or "MSN"
✓ bpp_terms has "accept_bap_terms" with value "Y" or "N"
✓ bpp_terms has "collect_payment" with value "Y" or "N"
```

### Provider validation

```
✓ provider.id is present and non-empty
✓ provider.time.label is "enable" or "disable"
✓ provider.time.timestamp is a valid ISO 8601 datetime (catalog version)
✓ provider.@ondc/org/fssai_license_no is present and is 14 digits (F&B mandatory)
✓ provider.ttl is a valid ISO 8601 duration (e.g. "P1D")
✓ provider.descriptor.name is present
```

### Location validation

```
✓ location.id is present and unique within provider
✓ location.time.label is "enable" or "disable"
✓ location.gps matches pattern "lat,lng" (decimal degrees)
✓ location.address.area_code is present (pincode)
✓ location.time.days contains only comma-separated integers 1–7
✓ location.time.range.start/end are 4-digit HHMM strings if present
```

### Category (CG) validation

```
✓ Each CG has an "id" field
✓ Each CG has tag "type" with value "custom_group"
✓ Each CG has tag "config" with "min" and "max" sub-fields
✓ config.min and config.max are non-negative integers (as strings)
✓ config.max >= config.min
✓ config.input is "select" or "text"
```

### Item validation — base items

```
✓ item.id is present and unique within provider
✓ item.category_id == "F&B"
✓ item.tags contains "type" with value "item"
✓ item.price.currency == "INR"
✓ item.price.value is a valid decimal string
✓ item.quantity.available.count is a non-negative integer string
✓ item.related == false (base items are not related)
✓ item.fulfillment_id references a valid fulfillment in provider.fulfillments OR bpp/fulfillments
  (NP-level). A fulfillment may be declared at either level; MSN aggregators often declare it at
  NP level and items point at that id. Validate against the union of both id sets.
✓ item.location_id references a valid location in provider.locations

MANDATORY CG CHECK:
✓ For each CG referenced in item.tags[custom_group], verify:
  - The CG definition exists in provider.categories
  - If CG.config.min >= 1 (mandatory CG):
    - At least one customization item has parent.id == CG.id
    - Those customization items have valid quantity.available.count > "0"
  - If this check fails: DISABLE THE BASE ITEM (do not show to buyer)
```

### Item validation — customization items

```
✓ item.tags contains "type" with value "customization"
✓ item.related == true
✓ item.tags contains "parent" with "id" sub-field
✓ parent.id references a valid CG id in provider.categories
✓ item.category_id == "F&B"
✓ item.price.currency == "INR"
✓ item.price.value is a valid non-negative decimal string (additive price)
✓ If "child" tag present: child.id references a valid CG id
✓ If "default" tag: value is "yes" or "no"
```

### Offer validation

```
✓ offer.id is present and unique within provider
✓ offer.descriptor.code is "discount", "buyXgetY", or "freebie"
✓ If offer.item_ids present: each item_id references a valid item in provider.items
✓ If offer.location_ids present: each location_id references a valid location
✓ If offer has "time": time.label == "valid" and range.start/end are valid ISO 8601
✓ offer.tags[qualifier].min_value is a positive decimal string if present
✓ offer.tags[benefit].value_type is "percent" or "amount"
✓ offer.tags[benefit].value is negative for discounts
✓ offer.tags[meta].auto is "yes" or "no"
```

---

## 5. Incremental on_search — ACK/NACK Rules

When BAP receives an incremental `/on_search` callback, it must respond synchronously with
ACK or NACK:

**ACK** — catalog was successfully ingested

**NACK** — catalog couldn't be ingested. Use these specific error codes:

| Situation | Error code | Error message format |
|---|---|---|
| Provider not found in cache | `20003` | `"[{provider_id:P1},{provider_id:P2}]"` |
| Provider location not found | `20004` | `"[{provider_id:P1,location_id:L1}]"` |
| Item not found | `20005` | `"[{provider_id:P1,item_id:I1}]"` |
| Multiple error types combined | `"20004,20005"` | Combined stringified JSON |
| All other errors | `20000` | Descriptive text string |

NACK response shape:

```json
{
  "context": {
    "domain": "ONDC:RET11",
    "action": "on_search",
    "bap_id": "buyerNP.com",
    "bap_uri": "https://buyerNP.com/ondc",
    "bpp_id": "sellerNP.com",
    "bpp_uri": "https://sellerNP.com/ondc",
    "transaction_id": "T1",
    "message_id": "M2",
    "timestamp": "2023-06-03T08:00:30.000Z"
  },
  "message": { "ack": { "status": "NACK" } },
  "error": {
    "type": "DOMAIN-ERROR",
    "code": "20003",
    "message": "[{provider_id:P1}]"
  }
}
```

**BPP retry behavior**: If BPP receives NACK or no response, it will retry the incremental
push until ACK is received from all BAPs. Design your webhook to be idempotent.

---

## 6. Catalog Ingestion Logic

### Full refresh ingestion

```
1. Validate context (transaction_id, message_id idempotency, domain, action)
2. Verify BPP signature (Ed25519 + BLAKE2b-512)
3. For each provider in bpp/providers[]:
   a. Parse provider.time.label:
      - "disable" → mark all items for this provider as inactive; stop processing
      - "enable" → continue
   b. Validate provider.@ondc/org/fssai_license_no (14 digits, required for F&B)
   c. Record provider.time.timestamp as catalog version
   d. For each location: process enable/disable
   e. For each category: separate custom_menu from custom_group
   f. Build CG map: { CG_id → { min, max, input, seq } }
   g. For each item in items[]:
      - Separate by type tag: "item" vs "customization"
      - For base items:
        * Run mandatory CG check (section 4)
        * If check fails: mark item disabled
        * Otherwise: upsert item in cache
      - For customizations: upsert in cache, link to parent CG
   h. Disable items in cache NOT present in this refresh (for this provider)
      Note: providers themselves can only be disabled via incremental refresh
4. Process offers: upsert by offer.id, respect time.range for validity
5. ACK the response
```

### Incremental refresh ingestion

```
1. Validate context (same transaction_id as start request for solicited;
   same transaction_id, different message_id for unsolicited push)
2. Verify BPP signature
3. For each provider delta:
   a. If provider present and time.label == "disable" → disable provider
   b. If provider present and time.label == "enable" → update provider fields
   c. For each item delta: use time.timestamp to resolve conflicts
      - If incoming timestamp > cached timestamp → apply update
      - If incoming timestamp ≤ cached timestamp → discard (stale)
4. Send ACK or NACK per section 5

Race condition rule:
  - If full refresh and incremental arrive simultaneously:
    Option A: Process full refresh first; restart incremental from provider.time.timestamp
    Option B: Process both; use timestamps to decide which updates to keep
```

### Pagination handling

BPP may send multiple `/on_search` callbacks for the same `/search` request (one per provider).
All will share the same `transaction_id` and `message_id`. Each must be processed independently.
Do not wait for all pages before processing — handle each callback as it arrives.
