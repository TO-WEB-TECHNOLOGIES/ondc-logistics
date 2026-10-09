# Confirm

Place the logistics order. Provider, items, quote, billing, payment and addresses all come from
the stored `/init` + `/on_init` data. **You can't change them here.** You only add
confirm-time details.

## `POST /logistics/confirm` (camelCase)

```json
{
  "initTransactionId": "a91e…",
  "fulfillments": [{
    "id": "1",
    "start": {
      "instructions": {
        "code": "2",
        "short_desc": "123456",
        "long_desc": "additional instructions for pickup",
        "additional_desc": { "content_type": "text/html", "url": "https://example.com/pickup.htm" }
      }
    },
    "end": {
      "instructions": { "code": "3", "short_desc": "654321", "long_desc": "additional instructions for delivery" }
    },
    "tags": [{ "code": "state", "list": [{ "code": "ready_to_ship", "value": "no" }] }]
  }],
  "linkedOrder": {
    "items": [{
      "category_id": "Grocery",
      "descriptor": { "name": "Atta" },
      "quantity": { "count": 1, "measure": { "unit": "kilogram", "value": 1 } },
      "price": { "currency": "INR", "value": "500.00" }
    }],
    "provider": {
      "descriptor": { "name": "Store Name" },
      "address": { "name": "Store Name", "building": "123", "locality": "Sector 1", "city": "Meerut", "state": "Uttar Pradesh", "country": "IND", "area_code": "250001" }
    },
    "order": {
      "id": "retail-order-id-123",
      "weight": { "unit": "kilogram", "value": 1 },
      "dimensions": {
        "length": { "unit": "centimeter", "value": 10 },
        "breadth": { "unit": "centimeter", "value": 10 },
        "height": { "unit": "centimeter", "value": 10 }
      }
    }
  }
}
```

### Fields

| Field | Req. | Notes |
|---|---|---|
| `initTransactionId` | yes | `transactionId` from the `/init` response. |
| `fulfillments[]` | no | Matched to the initialized fulfillment **by `id`**. Recognized keys only (below); anything else is ignored. |
| `fulfillments[].start.instructions` | no | Pickup instructions. `code: "2"` + `short_desc` = PCC (pickup confirmation code). |
| `fulfillments[].end.instructions` | no | Delivery instructions. `code: "3"` + `short_desc` = DCC (delivery confirmation code). |
| `fulfillments[].start.time` | no | Pickup slot, ONDC shape (`{ "range": { "start": "…", "end": "…" } }`). |
| `fulfillments[].tags` | no | Replaces the stored fulfillment tags. `state.ready_to_ship`: `"no"` if the package isn't ready yet; mark it ready later with `/update` `READY_TO_SHIP`. `"yes"` if it's ready now and no update will follow (requires `start.instructions.short_desc`). See [post-order.md](post-order.md#update). |
| `fulfillments[]["@ondc/org/awb_no"]` | no | AWB number, if you already have one. |
| `linkedOrder` | no (recommended) | The retail order this shipment carries. **Sent to the LSP as-is in ONDC shape** (`@ondc/org/linked_order`): snake_case keys exactly as above. |

Contact details, location and person name always come from `/init` and can't be overridden.
The buyer's acceptance of the LSP terms (`bap_terms.accept_bpp_terms = Y`) is added
automatically.

### Response `202`

```json
{ "orderId": "od260910a1b2c3d4", "transactionId": "a91e…", "messageId": "…", "status": "CONFIRM_SENT" }
```

**`orderId` is the key for every post-order call.** Store it.

| Error | Meaning |
|---|---|
| `400 INVALID_CONFIRM_REQUEST` | Body shape is wrong (`details[0].path`). |
| `409 CONFIRM_STATE_INVALID` | Init not found or not completed yet (no `init_result`), or the generated order failed validation. |
| `502 ONDC_NACK` / `ONDC_ACK_TIMEOUT` | The LSP rejected the request or didn't answer. |
| `502 CONFIRM_SUBMISSION_FAILED` | Other send failure. |

Don't fire `/confirm` twice for the same click. Disable the button until the response arrives.

## Async result: `order_confirmed`

```json
{
  "event": "order_confirmed",
  "transactionId": "a91e…",
  "orderId": "od260910a1b2c3d4",
  "state": "Accepted",
  "providerId": "P1",
  "item": { "itemId": "I1", "name": "Standard Delivery", "quantityCount": 1 },
  "fulfillment": { "fulfillmentId": "1", "type": "Delivery", "state": "Pending", "awbNo": "1227262193237777" },
  "quote": { "priceAmount": "70.80", "priceCurrency": "INR" },
  "billing": { "name": "Buyer Name", "email": "buyer@example.com", "phone": "9111111111" },
  "payment": { "type": "ON-ORDER", "collectedBy": "BAP" }
}
```

- `state` is the order state (`Created` / `Accepted` / …). `fulfillment.state` is the
  fulfillment state (`Pending`, `Agent-assigned`, …).
- `awbNo` may be empty here and come later via `order_status` / `order_updated`.

`confirm_error` → `{ orderId, code, message }`: the LSP rejected the order.
