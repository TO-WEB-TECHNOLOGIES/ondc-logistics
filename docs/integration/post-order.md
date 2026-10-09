# Post-order: status, track, cancel, update

Every call here is keyed by the `orderId` returned by `/confirm`, and every body is
**camelCase**. All of them accept an optional `context` override you normally leave out:

```json
"context": { "transaction_id": "…", "message_id": "…" }
```

It defaults to the order's stored transaction and a fresh message id.

## Order and fulfillment states

`order_status.state` is the **order state**; `fulfillmentState` is the **fulfillment state**
(drive the progress UI from this). Values from the ONDC contract:

| Fulfillment state | Meaning | Order state |
|---|---|---|
| `Pending` | default | `Created` / `Accepted` |
| `Searching-for-Agent` | after ready-to-ship | `In-progress` |
| `Agent-assigned` | rider assigned | `In-progress` |
| `Out-for-pickup` / `Pickup-failed` / `Pickup-rescheduled` | intercity pickup | `In-progress` |
| `At-pickup` | rider at pickup (hyperlocal) | `In-progress` |
| `Order-picked-up` | picked up | `In-progress` |
| `In-transit` / `At-destination-hub` | intercity hubs | `In-progress` |
| `Out-for-delivery` | | `In-progress` |
| `At-delivery` | rider at drop (hyperlocal) | `In-progress` |
| `Delivery-failed` / `Delivery-rescheduled` | intercity | `In-progress` |
| `Order-delivered` | delivered | `Completed` |
| `Cancelled` | cancelled | `Cancelled` |
| `RTO-Initiated` | return to origin started | unchanged |
| `RTO-Delivered` / `RTO-Disposed` | RTO finished | `Cancelled` |

LSPs push `order_status` on their own at each transition. You don't need to poll `/status`.

---

## Status

### `POST /logistics/status`

```json
{ "orderId": "od260910a1b2c3d4" }
```

`202` → `{ "orderId", "transactionId", "messageId", "status": "STATUS_SENT" }`

Errors: `400 INVALID_STATUS_REQUEST`, `409 STATUS_STATE_INVALID` (order not found),
`502 ONDC_NACK` / `ONDC_ACK_TIMEOUT` / `STATUS_SUBMISSION_FAILED`.

### SSE `order_status`

```json
{ "event": "order_status", "transactionId": "…", "orderId": "od…", "state": "In-progress",
  "fulfillmentState": "Agent-assigned", "awbNo": "1227262193237777", "updatedAt": "2026-10-08T10:00:00.000Z" }
```

`status_error` → `{ orderId, code, message }`.

### `GET /logistics/orders/:orderId/status`

Reads the stored order without calling ONDC. Use it for the first page load and after reconnects.

`200` → `{ "orderId", "state", "fulfillmentId", "fulfillmentState", "awbNo", "updatedAt" }` ·
`404 ORDER_NOT_FOUND`

---

## Track

Only call this **after pickup** (rider assigned and fulfillment state `Order-picked-up` or later).
Earlier, the LSP answers with error `60012` (as a `502 ONDC_NACK` or a `track_error`).

### `POST /logistics/track`

```json
{ "orderId": "od260910a1b2c3d4" }
```

`202` → `{ "orderId", "transactionId", "messageId", "status": "TRACK_SENT" }`

Errors: `400 INVALID_TRACK_REQUEST`, `409 TRACK_STATE_INVALID`, `502 …`.

### SSE `order_tracking`

```json
{
  "event": "order_tracking", "transactionId": "…", "orderId": "od…",
  "url": "https://lsp.example.com/track/AWB123",
  "status": "active",
  "gps": "12.974002,77.613458",
  "locationTimestamp": "2026-10-08T10:05:00.000Z",
  "path": [{ "lat_lng": "12.97,77.61", "sequence": "1" }],
  "updatedAt": "2026-10-08T10:05:02.000Z"
}
```

- `status`: `active` = live tracking is available, `inactive` = not (yet). Show `url` and/or a
  map pin at `gps`.
- `path` is the breadcrumb trail, if the LSP sends one.
- To refresh live tracking, call `/track` again (e.g. every 30–60 s while the page is open).

`track_error` → `{ orderId, code, message }`.

### `GET /logistics/orders/:orderId/track`

`200` → `{ "orderId", "url", "status", "gps", "locationTimestamp", "updatedAt" }` (last stored
snapshot, no `path`) · `404 ORDER_NOT_FOUND`

---

## Cancel

### `POST /logistics/cancel`

```json
{ "orderId": "od260910a1b2c3d4", "cancellationReasonId": "052" }
```

`cancellationReasonId` must be a reason **the buyer side is allowed to send**:

| Code | Reason |
|---|---|
| `001` | Price of one or more items changed; buyer was asked to pay more |
| `003` | Product available at lower than order price |
| `051` (legacy `004`) | Store is not accepting order |
| `009` | Wrong product delivered |
| `052` (legacy `006`) | Order / fulfillment not received as per O2D TAT |
| `053` (legacy `010`) | Buyer wants to modify address / other order details |
| `999` | Order confirmation failure |

Any other code → `400 INVALID_CANCEL_REQUEST` (the message says who may use that code).

`202` → `{ "orderId", "transactionId", "messageId", "status": "CANCEL_SENT" }`

Errors: `400`, `409 CANCEL_STATE_INVALID` (order not found / already cancelled), `502 …`.

**The order is not cancelled yet at this point.** Show "cancellation requested" until the event
arrives. A fee may apply according to the `cancellationTerms` from [init](init.md).

### SSE `order_cancelled`

```json
{ "event": "order_cancelled", "transactionId": "…", "orderId": "od…", "state": "Cancelled",
  "fulfillmentState": "Cancelled", "awbNo": "…", "cancellationReasonId": "052",
  "cancellationReasonText": "Order / fulfillment not received as per O2D TAT",
  "cancelledBy": "logistics_buyer.com", "updatedAt": "…" }
```

The LSP may also cancel **on its own** (e.g. an RTO flow). The same event arrives without
you calling `/cancel`, and `cancelledBy` is the LSP. `cancel_error` → `{ orderId, code, message }`:
the LSP refused the cancellation.

---

## Update

Full reference with every variant: [`docs/api/update.md`](../api/update.md). Summary:

### `POST /logistics/update`

Common fields: `orderId`, `fulfillmentId` (the order's fulfillment id, used as an identity
check), `updateType`.

| `updateType` | Extra field | Use |
|---|---|---|
| `READY_TO_SHIP` | `linkedOrder?` (same fields as below; overrides the stored linked order) | Package is ready; the LSP starts assigning a rider. Sets `ready_to_ship = "yes"` and also sends the stored linked order and PCC. |
| `START_INSTRUCTION` / `END_INSTRUCTION` | `instruction: { code, shortDesc?, longDesc?, images?[] }` | Change pickup / delivery instructions (PCC/DCC). |
| `START_AUTHENTICATION` / `END_AUTHENTICATION` | `authorization: { token, type?="OTP", validFrom?, validTo? }` | Send the pickup / delivery OTP. Validity defaults to now → now+10 min. |
| `LINKED_ORDER_DETAILS` | `linkedOrder: { retailOrderId?, productName?, quantityCount?, weight?, dimensions?, providerName? }` (at least one) | Partial update of the retail order details. |

```json
{ "orderId": "od260910a1b2c3d4", "fulfillmentId": "1", "updateType": "START_AUTHENTICATION",
  "authorization": { "token": "482913" } }
```

```json
{ "orderId": "od260910a1b2c3d4", "fulfillmentId": "1", "updateType": "READY_TO_SHIP" }
```

**Ready-to-ship pattern:** confirm with `state.ready_to_ship = "no"` if the package isn't packed
yet, then send `READY_TO_SHIP` when it is. If it's already packed at checkout, confirm with
`"yes"` and skip the update. Either way, `"yes"` needs the PCC
(`start.instructions.short_desc`), sent at confirm or via `START_INSTRUCTION`.

`202` → `{ "orderId", "transactionId", "messageId", "updateType", "status": "UPDATE_SENT" }`

Errors: `400 INVALID_UPDATE_REQUEST`, `409 UPDATE_STATE_INVALID` (order not found / fulfillment
mismatch), `502 …`.

### SSE `order_updated`

```json
{ "event": "order_updated", "transactionId": "…", "orderId": "od…", "state": "In-progress",
  "awbNo": "…", "updatedAt": "…" }
```

Only the fields present on the callback are set. Refresh with
`GET /logistics/orders/:orderId/status` if you need the full current state.
`update_error` → `{ orderId, code, message }`.
