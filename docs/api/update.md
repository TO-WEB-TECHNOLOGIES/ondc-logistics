# `/update` API — request bodies by update type

A single app-level endpoint, `POST /logistics/update`, supports several
kinds of ONDC `/update` request. The frontend selects which one via the
`updateType` field — this field is an **app-specific enum only**; it is
never forwarded to ONDC. On the wire, every `updateType` produces an ONDC
`/update` request with `message.update_target` hardcoded to `"fulfillment"`,
since the contract (`docs/ondc/ondc logistics.docx`, "/update" section) does
not define any other `update_target` value — the different update *kinds*
are distinguished entirely by which sub-fields of `order` are populated, not
by a contract-level enum.

The companion callback endpoint is `POST /on_update` (LSP → us); it is not
called by the frontend.

## Common fields (every request)

| Field | Required | Notes |
|---|---|---|
| `orderId` | yes | The `order_id` returned by `/confirm` (`logistics_order.order_id`). |
| `fulfillmentId` | yes | Must match the order's stored `fulfillment_id` — used as an identity check to confirm you're updating the right shipment. logistics_order stores one fulfillment per order, so this does not select among several. |
| `updateType` | yes | One of the six values below. |
| `context.transaction_id` | no | Defaults to the order's stored ONDC `transaction_id`. Only override if you know what you're doing. |
| `context.message_id` | no | Defaults to a freshly generated id. |

Response shape (all types):

```json
{
  "orderId": "od260910a1b2c3d4",
  "transactionId": "T1",
  "messageId": "b6f...",
  "updateType": "READY_TO_SHIP",
  "status": "UPDATE_SENT"
}
```

---

## `LINKED_ORDER_DETAILS`

Updates the linked retail order's details (`@ondc/org/linked_order`) — id,
product, weight, dimensions, provider name. Contract use case: *"Update
linked order details in case of part return / cancel for retail order."*

All `linkedOrder` sub-fields are optional individually, but at least one
must be supplied. Anything you omit keeps its previously stored value —
this is a partial update, not a full replace.

```json
{
  "orderId": "od260910a1b2c3d4",
  "fulfillmentId": "1",
  "updateType": "LINKED_ORDER_DETAILS",
  "linkedOrder": {
    "retailOrderId": "O1",
    "productName": "Atta",
    "quantityCount": 2,
    "weight": { "unit": "kilogram", "value": 1 },
    "dimensions": {
      "length": { "unit": "centimeter", "value": 1 },
      "breadth": { "unit": "centimeter", "value": 1 },
      "height": { "unit": "centimeter", "value": 1 }
    },
    "providerName": "Aadishwar Store"
  }
}
```

## `START_INSTRUCTION` / `END_INSTRUCTION`

Updates the pickup (start / PCC) or delivery (end / DCC) instructions.
Contract use case: *"Provide updated delivery instructions to LSP."*

`code` is required (the PCC/DCC code); the rest are optional.

```json
{
  "orderId": "od260910a1b2c3d4",
  "fulfillmentId": "1",
  "updateType": "START_INSTRUCTION",
  "instruction": {
    "code": "2",
    "shortDesc": "Ring the bell twice",
    "longDesc": "Leave with the security guard if no answer",
    "images": ["https://example.com/pickup_image.png"]
  }
}
```

Same shape for `END_INSTRUCTION` (delivery instructions).

## `START_AUTHENTICATION` / `END_AUTHENTICATION`

Sets the OTP (or other) authorization for pickup (start) or delivery (end).
Contract use case: *"Update authorization details for pickup / delivery."*
This is how the frontend sends an OTP code to be relayed to the LSP.

`token` is required. `type` defaults to `"OTP"` if omitted. `validFrom`/
`validTo` default to *now* / *now + 10 minutes* if omitted.

```json
{
  "orderId": "od260910a1b2c3d4",
  "fulfillmentId": "1",
  "updateType": "START_AUTHENTICATION",
  "authorization": {
    "token": "482913"
  }
}
```

With explicit validity window:

```json
{
  "orderId": "od260910a1b2c3d4",
  "fulfillmentId": "1",
  "updateType": "END_AUTHENTICATION",
  "authorization": {
    "type": "OTP",
    "token": "731204",
    "validFrom": "2026-09-10T12:00:00.000Z",
    "validTo": "2026-09-10T14:00:00.000Z"
  }
}
```

Note: the OTP `token` is persisted to `logistics_order.start_authorization_token`
/ `end_authorization_token` and sent to the LSP as part of the /update wire
payload. It is not stored anywhere else and is not logged in full (see
`ondc-logger.ts`'s payload truncation).

## `READY_TO_SHIP`

Marks the fulfillment ready to ship. Contract use case: *"Notify LSP that
retail order is ready to ship."* Produces
`order.fulfillments[].tags = [{code: "state", list: [{code: "ready_to_ship", value: "yes"}]}]`
and is persisted via the shared `tags`/`tag_values` tables
(`tags.logistics_order_id`), not a column.

No extra fields beyond the common ones:

```json
{
  "orderId": "od260910a1b2c3d4",
  "fulfillmentId": "1",
  "updateType": "READY_TO_SHIP"
}
```

---

## Notes / limitations

- `logistics_order` stores a single primary item, fulfillment, and
  linked-order line per order — these update types operate on that single
  fulfillment; there is no way to address a second fulfillment on the same
  order through this API today.
- Every request is idempotent per `(transaction_id, message_id, action,
  order_id)` — retrying the exact same `/update` call (same `context`) is
  safe and will not double-send.
- `/on_update` callbacks are always ACKed immediately and processed
  asynchronously; a weight/dimension differential proposed by the LSP
  (`diff_dim`/`diff_weight`/`diff_proof` tags) is not yet parsed or disputed
  by this endpoint — see the implementation notes for `update.repository.ts`.
- **Every** `/update` request echoes the fulfillment's currently stored tags
  (fetched from `tags`/`tag_values`), not just the tag the specific
  `updateType` sets. This matters once `READY_TO_SHIP` has run: from then
  on, `state: ready_to_ship = "yes"` is included on every subsequent
  `/update` call for that order (`LINKED_ORDER_DETAILS`, instructions,
  authentication), regardless of type. Omitting it was observed to trip the
  ONDC workbench's `VALIDATE_TAG_STATE_VALUES_FOR_IMMEDIATE_DELIVERY` check
  on later calls for an Immediate Delivery order.
- Only tag codes the ONDC workbench allows on a fulfillment (`state`,
  `rider_details`, `linked_provider`, `linked_order`, `linked_order_item`,
  `fulfill_request`, `rto_verification`, `fulfill_response`, `special_req`,
  `linked_package`) are echoed — anything else stored (e.g. a stray tag code
  supplied at `/confirm`) is silently dropped from the `/update` wire
  payload (workbench's `validate_tag_0`). It stays in the database
  unchanged; only the outbound echo is filtered.
- Whenever `state: ready_to_ship = "yes"` is being echoed, the payload also
  includes `fulfillments[].start.instructions` (`code`/`short_desc`) pulled
  from stored data, even for update types that don't otherwise touch
  instructions — the workbench separately requires a non-empty start
  `short_desc` whenever `ready_to_ship = "yes"` is present
  (`start_instructions_short_desc_present`). A `START_INSTRUCTION` call that
  omits `shortDesc` falls back to the previously stored value rather than
  sending an empty one.
