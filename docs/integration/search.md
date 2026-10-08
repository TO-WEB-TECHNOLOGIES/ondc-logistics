# Search

Ask LSPs which delivery options can carry a package from A to B.

## `POST /logistics/search`

Open the SSE stream first ([stream.md](stream.md)), then:

```json
{
  "client_id": "8f1c…-uuid",
  "category_id": "Standard Delivery",
  "start": {
    "gps": "28.984500,77.706400",
    "area_code": "250001",
    "address": {
      "name": "Pickup Person",
      "building": "123",
      "locality": "Sector 1",
      "street": "Main Road",
      "city": "Meerut",
      "state": "Uttar Pradesh",
      "country": "IND"
    }
  },
  "end": {
    "gps": "28.613900,77.209000",
    "area_code": "110001",
    "address": {
      "name": "Delivery Person",
      "building": "456",
      "locality": "Connaught Place",
      "city": "New Delhi",
      "state": "Delhi",
      "country": "IND"
    }
  },
  "schedule": {
    "days": "1,2,3,4,5,6,7",
    "range_start": "0000",
    "range_end": "2359",
    "duration": "PT30M",
    "holidays": ["2026-01-26"]
  },
  "payload": {
    "weight": { "value": 1, "unit": "kilogram" },
    "dimensions": {
      "length": { "value": 10, "unit": "centimeter" },
      "breadth": { "value": 10, "unit": "centimeter" },
      "height": { "value": 10, "unit": "centimeter" }
    },
    "category": "Grocery",
    "value": { "amount": "100", "currency": "INR" },
    "dangerous_goods": false
  },
  "payment": { "type": "POST-FULFILLMENT", "collection_amount": "300.00" }
}
```

### Fields

| Field | Req. | Notes |
|---|---|---|
| `client_id` | no* | Your SSE `clientId`. *Without it, no unified-stream events arrive for this search. |
| `category_id` | yes | Delivery category, e.g. `Immediate Delivery`, `Same Day Delivery`, `Next Day Delivery`, `Standard Delivery`, `Express Delivery`, `Instant Delivery`. |
| `start.gps`, `end.gps` | yes | `"lat,lng"`, **exactly 6 decimal places** each (`28.984500,77.706400`). An optional space after the comma is allowed. |
| `start.area_code`, `end.area_code` | yes | PIN code. **Sits on `start`/`end`, not inside `address`.** |
| `*.address.name/building/locality/city/state/country` | yes | Non-empty strings. `name` is reused later as the pickup/drop person's name. |
| `*.address.street` | no | |
| `schedule.days` | yes | Comma-separated weekdays, 1 = Monday … 7 = Sunday. |
| `schedule.range_start`, `range_end` | yes | `HHMM`, e.g. `"0000"`, `"2359"`. |
| `schedule.duration` | no | ISO-8601 duration, e.g. `PT30M`. |
| `schedule.holidays` | no | Array of `YYYY-MM-DD`. |
| `payload.weight` | yes | `{ value, unit }`, e.g. unit `kilogram`. |
| `payload.dimensions.length/breadth/height` | yes | `{ value, unit }`, e.g. unit `centimeter`. |
| `payload.category` | yes | Goods category, e.g. `Grocery`. |
| `payload.value` | yes | `{ amount, currency }`: declared value of the goods. **`amount`, not `value`.** |
| `payload.dangerous_goods` | yes | Boolean. |
| `payment.type` | no | `ON-ORDER` \| `ON-FULFILLMENT` \| `POST-FULFILLMENT`. |
| `payment.collection_amount` | no | Cash-on-delivery amount to collect. |

Pickup/delivery authorization is always `OTP`; the backend sets it, so don't send it.

### Response `202`

```json
{ "searchId": "c2b7…", "transactionId": "a91e…", "messageId": "5d0f…", "status": "SEARCH_SENT" }
```

Keep `searchId` (needed for `/init`) and `transactionId`.

Errors: `400 INVALID_SEARCH_REQUEST` (the message names the bad field),
`502 ONDC_NACK` / `ONDC_ACK_TIMEOUT`, `500 SEARCH_FAILED`.

## SSE `search_result`

One event **per provider per LSP response**. Several LSPs may answer, each with one or more
providers. Append them as they arrive, and stop listening after your own timeout. There is no
completion event.

```json
{
  "event": "search_result",
  "transactionId": "a91e…",
  "searchId": "c2b7…",
  "provider": {
    "providerId": "P1",
    "name": "LSP Express",
    "shortDescription": "…",
    "longDescription": "…",
    "categories": [{ "categoryId": "Standard Delivery", "timeLabel": "TAT", "duration": "P1D", "timestamp": "2023-06-06" }],
    "fulfillments": [{ "fulfillmentId": "1", "type": "Delivery", "pickupDuration": "PT15M", "motorableDistance": "12.5", "motorableDistanceUnit": "km" }],
    "locations": [{ "locationId": "L1", "gps": "…", "street": "…", "city": "…", "state": "…", "areaCode": "…" }],
    "items": [{
      "catalogItemId": "I1",
      "parentItemId": "…",
      "categoryId": "Standard Delivery",
      "fulfillmentId": "1",
      "descriptorCode": "P2P",
      "name": "Standard Delivery",
      "shortDescription": "…",
      "longDescription": "…",
      "tatLabel": "TAT",
      "tatDuration": "P1D",
      "tatTimestamp": "2023-06-06",
      "priceAmount": "59.00",
      "priceCurrency": "INR"
    }]
  }
}
```

What the UI usually shows per item: `name`, `priceAmount` + `priceCurrency`, `tatDuration`
(ISO-8601 duration, e.g. `PT45M`, `P1D`), and the fulfillment's `motorableDistance`.

What you need to keep for `/init`: `searchId`, `provider.providerId`, `item.catalogItemId`,
`item.fulfillmentId`.

> The SSE `provider` has **no `bppId`**. If two LSPs return the same provider/item/fulfillment
> ids, `/init` will answer `409` (ambiguous). Use the polling endpoint below to get `bppId` in that case.

## `GET /logistics/search/:searchId/options`

A polling alternative, and the recovery path after a missed event or a reload.

| Status | Body |
|---|---|
| `202` | `{ "searchId": "…", "status": "PENDING", "options": [] }`: no LSP has answered yet |
| `200` | `{ "searchId": "…", "status": "READY", "options": [ … ] }` |
| `404` | `SEARCH_NOT_FOUND` |

`options[]` uses a **different shape** from the SSE `provider`:

```json
{
  "bppId": "lsp.example.com",
  "bppUri": "https://lsp.example.com/ondc",
  "providerId": "P1",
  "provider": { "name": "LSP Express", "short_desc": "…", "long_desc": "…" },
  "locations": [{ "id": "L1", "gps": "…", "address": { "name": "…", "building": "…", "locality": "…", "street": "…", "city": "…", "state": "…", "country": "…", "area_code": "…" } }],
  "items": [{
    "itemId": "I1",
    "categoryId": "Standard Delivery",
    "fulfillmentId": "1",
    "descriptor": { "code": "P2P", "name": "…", "short_desc": "…", "long_desc": "…" },
    "price": { "currency": "INR", "value": "59.00" },
    "time": { "label": "TAT", "duration": "P1D", "timestamp": "2023-06-06T00:00:00.000Z" }
  }],
  "fulfillments": [{ "id": "1", "type": "Delivery", "start": { "time": { "duration": "PT15M" } }, "tags": [ … ] }]
}
```

Mapping between the two: `catalogItemId` ↔ `items[].itemId`, `fulfillmentId` ↔
`fulfillments[].id`. `200 READY` means at least one LSP answered; more may still arrive.
