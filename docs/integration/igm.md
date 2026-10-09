# IGM: issues and complaints

Raise a complaint about a confirmed order, follow its progress, and close (or escalate) it.
The backend speaks **IGM MVP v1.0.0** to the network (Scenario 1 of the ONDC IGM 1.0.0
contract). Request bodies are **snake_case**. IGM reuses the order's `transaction_id`, so its
events arrive on the same unified stream.

Lifecycle:

```
POST /logistics/issue (create)  → issue_updated         (LSP: PROCESSING)
      … LSP works on it …       → issue_status_updated  (LSP: RESOLVED + resolution + resolution provider)
POST /logistics/issue CLOSE     (accept; optional rating)
   or POST /logistics/issue ESCALATE  (not satisfied → GRIEVANCE)
```

## Raise a complaint: `POST /logistics/issue` (no `issue_id`)

```json
{
  "order_id": "od260910a1b2c3d4",
  "category_code": "ITEM_QUALITY",
  "descriptor_long_desc": "The package arrived damaged.",
  "descriptor_additional_desc_url": "https://buyerapp.com/additional-details/desc.txt",
  "images": ["https://buyerapp.com/images/img1.png"],
  "items": [{ "id": "I1", "quantity": 1 }]
}
```

| Field | Req. | Notes |
|---|---|---|
| `order_id` | yes | `orderId` from `/confirm`. |
| `category_code` | yes | One of the codes below. |
| `descriptor_long_desc` | yes | The user's description of the problem. |
| `items` | item categories | ≥ 1 `{ id, quantity }` for item categories (`ITM…`); optional for `PACKAGING_ISSUE`. `id` = `item.itemId` from `order_confirmed`; `quantity` = integer ≥ 1. |
| `images` | 📷 categories | Array of **image URL strings**. Upload files yourself first and send public URLs. (`[{ "url": … }]` objects are also accepted.) |
| `descriptor_additional_desc_url` | no | URL to a longer description (sent as `text/plain`). |

| `category_code` | Label (dropdown) | IGM 1.0 sub-category | |
|---|---|---|---|
| `ITEM_MISSING` | Missing items | ITM01 | |
| `ITEM_QUANTITY` | Quantity issue | ITM02 | 📷 |
| `WRONG_ITEM` | Item mismatch | ITM03 | 📷 |
| `ITEM_QUALITY` | Quality issue | ITM04 | 📷 |
| `ITEM_EXPIRED` | Expired item | ITM05 | 📷 |
| `PACKAGING_ISSUE` | Packaging issue | FLM04 | 📷 |

Not available yet (no confirmed IGM 1.0 code; the API rejects them with `400`):
`ITEM_WRONGLY_RETURNED`, `DELIVERY_DELAY`. `CANCEL_NO_RESPONSE` is internal-only.

The backend fills in everything else on the wire: the complainant's name/phone/email (from the
order's billing), order/fulfillment state, provider id, expected response (2 h) and resolution
(1 day) times.

`202` → `{ "issueId": "…", "transactionId": "…", "messageId": "…", "status": "ISSUE_SENT" }`.
**Store `issueId`.**

## Close or escalate: `POST /logistics/issue` (with `issue_id`)

Close (accept the resolution, or close it yourself at any time):

```json
{ "issue_id": "iss261008b1fa4426", "action_code": "CLOSE", "rating": "THUMBS-UP" }
```

Escalate (not satisfied with the resolution):

```json
{ "issue_id": "iss261008b1fa4426", "action_code": "ESCALATE", "short_desc": "Not satisfied with the resolution" }
```

| Field | Req. | Notes |
|---|---|---|
| `issue_id` | yes | From the create response. |
| `action_code` | yes | `CLOSE` or `ESCALATE`. |
| `rating` | no | `THUMBS-UP` / `THUMBS-DOWN`. `CLOSE` only. |
| `short_desc` | no | Note shown in the action trail. Defaults: "Complaint closed" / "Escalated to grievance". |

Rules (otherwise `409 ISSUE_STATE_INVALID`):
- Nothing is allowed on a `CLOSED` issue.
- `ESCALATE` needs the LSP to have resolved the issue first (`respondentStatus: "RESOLVED"`), and
  works once (`issueType` becomes `GRIEVANCE`).
- Issues raised before the IGM 1.0 switch can't be updated.

There is no resolution id in IGM 1.0: closing **is** accepting, and escalating is rejecting.

`202` → same shape as create.

## Ask for the latest status: `POST /logistics/issue_status`

```json
{ "issue_id": "…" }
```

`202` → `{ "issueId", "transactionId", "messageId", "status": "ISSUE_STATUS_SENT" }`.
`409` = issue not found. The answer arrives as `issue_status_updated`. LSPs also push it on
their own.

## Read an issue: `GET /logistics/issues/:issueId`

Reads the stored issue without calling ONDC. Call it on page load and after every
`issue_updated` / `issue_status_updated` event.

`200`:

```json
{
  "issueId": "iss261008b1fa4426",
  "orderId": "od260910a1b2c3d4",
  "transactionId": "fb9fc20b-…",
  "bppId": "workbench.ondc.tech",
  "categoryCode": "ITEM_QUALITY",
  "subCategory": "ITM04",
  "status": "OPEN",
  "issueType": "ISSUE",
  "respondentStatus": "RESOLVED",
  "shortDesc": "Quality issue",
  "longDesc": "The package arrived damaged.",
  "expectedResponseDuration": "PT2H",
  "expectedResolutionDuration": "P1D",
  "resolution": {
    "actionTriggered": "REFUND",
    "shortDesc": "Refund to be initiated",
    "longDesc": "For this complaint, refund is to be initiated",
    "refundAmount": "59.00"
  },
  "resolutionProvider": {
    "type": "TRANSACTION-COUNTERPARTY-NP",
    "organization": { "orgName": "workbench.ondc.tech::nic2004:60232", "personName": "…", "phone": "9059304940", "email": "email@resolutionproviderorg.com" },
    "support": { "chatLink": "http://chat-link/respondent", "phone": "9949595059", "email": "respondantemail@resolutionprovider.com" },
    "gros": [{ "groType": "TRANSACTION-COUNTERPARTY-NP-GRO", "personName": "Sam D", "phone": "9605960796", "email": "email@gro.com" }]
  },
  "refs": [
    { "refId": "od260910a1b2c3d4", "refType": "ORDER" },
    { "refId": "P1", "refType": "PROVIDER" },
    { "refId": "1", "refType": "FULFILLMENT" },
    { "refId": "I1", "refType": "ITEM", "quantityCount": "1" }
  ],
  "actors": [{ "actorId": "complainant", "actorType": "COMPLAINANT", "personName": "Buyer Name", "contactPhone": "…", "contactEmail": "…" }],
  "actions": [
    { "actionId": "complainant-0", "side": "complainant", "code": "OPEN", "shortDesc": "Complaint created", "updatedAt": "2026-10-08T07:43:50.391Z" },
    { "actionId": "respondent-0", "side": "respondent", "cascadedLevel": 1, "code": "PROCESSING", "shortDesc": "Complaint is being processed",
      "updatedAt": "2026-10-08T07:43:52.989Z", "actorOrgName": "workbench.ondc.tech::nic2004:60232", "actorPersonName": "Jane Doe",
      "actorPhone": "9450394140", "actorEmail": "respondentapp@respond.com" },
    { "actionId": "respondent-1", "side": "respondent", "cascadedLevel": 1, "code": "RESOLVED", "shortDesc": "Complaint resolved", "updatedAt": "2026-10-08T07:43:54.270Z" }
  ],
  "createdAt": "2026-10-08T07:43:50.391Z",
  "updatedAt": "2026-10-08T07:43:54.270Z"
}
```

- **`respondentStatus`** is the LSP's latest action: `PROCESSING`, `NEED-MORE-INFO`,
  `CASCADED`, `RESOLVED`. **Drive the progress UI from this.**
- **`status`** is yours: `OPEN` until you send `CLOSE`, then `CLOSED`. `issueType`: `ISSUE` →
  `GRIEVANCE` after `ESCALATE`. `rating` appears once you've closed with one.
- `resolution` and `resolutionProvider` appear once the LSP resolves the issue. Show the
  resolution and the support contact / chat link / GRO, then offer **Close** and
  **Escalate**.
- `actions` is the full timeline, oldest first (`side`: `complainant` = you, `respondent` = LSP).
- Optional fields are omitted when empty.

`404 ISSUE_NOT_FOUND` · `500 ISSUE_DETAILS_FAILED`

## List an order's issues: `GET /logistics/orders/:orderId/issues`

`200` (newest first; `issues: []` when there are none, including for an unknown order):

```json
{
  "orderId": "od260910a1b2c3d4",
  "issues": [
    { "issueId": "iss261008b1fa4426", "categoryCode": "ITEM_QUALITY", "subCategory": "ITM04",
      "status": "OPEN", "issueType": "ISSUE",
      "createdAt": "2026-10-08T07:43:50.391Z", "updatedAt": "2026-10-08T07:43:54.270Z" }
  ]
}
```

`500 ORDER_ISSUES_FAILED`

## SSE events

| Event | Payload |
|---|---|
| `issue_updated` | `{ issueId, orderId, newActionCount }`: the LSP replied to `/issue`, or pushed an update itself |
| `issue_error` | `{ issueId, orderId, code, message }` |
| `issue_status_updated` | `{ issueId, orderId, newActionCount }`: reply to `/issue_status`, or an update the LSP pushed itself |
| `issue_status_error` | `{ issueId, orderId, code, message }` |

`newActionCount` is the number of new LSP actions in that callback. `0` means nothing new
happened. The events only tell you *which* issue changed. Fetch
`GET /logistics/issues/:issueId` for the details.

IGM error codes you may see in `*_error` events: `IGM002`/`IGM003`/`IGM004` (order, fulfillment
or item id doesn't match), `IGM005` (unknown issue id), `IGM008` (duplicate complaint for the
same item and category).

## Errors

`400 INVALID_ISSUE_REQUEST` (bad body, unknown or unsupported category, missing images or
items, `rating` without `CLOSE`) · `409 ISSUE_STATE_INVALID` · `502 ONDC_NACK` /
`ONDC_ACK_TIMEOUT` / `ISSUE_SUBMISSION_FAILED` · `500 ISSUE_FAILED`.
