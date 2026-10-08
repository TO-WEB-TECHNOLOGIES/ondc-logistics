# IGM: issues and complaints

Raise a complaint about a confirmed order, follow up on it, and close it. The body is
**snake_case**. IGM reuses the order's `transaction_id`, so its events arrive on the same
unified stream.

## Raise a complaint: `POST /logistics/issue` (no `issue_id`)

```json
{
  "order_id": "od260910a1b2c3d4",
  "category_code": "ITEM_QUALITY",
  "descriptor_long_desc": "The package arrived damaged.",
  "descriptor_additional_desc_url": "https://buyerapp.com/additional-details/desc.txt",
  "images": [{ "url": "https://buyerapp.com/images/img1.png", "size_type": "xs" }],
  "media": [{ "url": "https://buyerapp.com/media/video1.mp4" }],
  "items": [{ "id": "I1", "quantity": 1 }]
}
```

| Field | Req. | Notes |
|---|---|---|
| `order_id` | yes | `orderId` from `/confirm`. |
| `category_code` | yes | One of the codes below. |
| `descriptor_long_desc` | yes | The user's description of the problem. |
| `items` | yes | ≥ 1 entry, `{ id, quantity }`. `id` is the order's item id (`item.itemId` from `order_confirmed`). `quantity` is an integer ≥ 1. |
| `images` | conditional | `[{ url, size_type? }]`. **Required for categories marked 📷.** Upload the files yourself first; send public URLs. |
| `media` | no | `[{ url }]` (e.g. video). |
| `descriptor_additional_desc_url` | no | URL to a longer description. |

| `category_code` | Label (dropdown) | ONDC code | |
|---|---|---|---|
| `ITEM_MISSING` | Missing items | ITM001 | |
| `ITEM_QUANTITY` | Quantity issue | ITM002 | 📷 |
| `WRONG_ITEM` | Item mismatch | ITM003 | 📷 |
| `ITEM_QUALITY` | Quality issue | ITM004 | 📷 |
| `ITEM_EXPIRED` | Expired item | ITM005 | 📷 |
| `ITEM_WRONGLY_RETURNED` | Incorrectly marked as returned | ITM006 | |
| `PACKAGING_ISSUE` | Packaging issue | FLM005 | 📷 |
| `DELIVERY_DELAY` | Delayed delivery | ORD003 | |

(`CANCEL_NO_RESPONSE` exists for internal use only. Don't show it in the dropdown.)

`202` → `{ "issueId": "…", "transactionId": "…", "messageId": "…", "status": "ISSUE_SENT" }`.
**Store `issueId`.**

## Follow up / close: `POST /logistics/issue` (with `issue_id`)

```json
{ "issue_id": "…", "action_code": "CLOSED", "descriptor_long_desc": "Resolved, thanks." }
```

| Field | Req. | Notes |
|---|---|---|
| `issue_id` | yes | From the create response. |
| `action_code` | yes | `OPEN`, `ESCALATED`, `INFO_PROVIDED`, `RESOLUTION_ACCEPTED`, `RESOLUTION_REJECTED`, `CLOSED`. |
| `resolution_id` | conditional | **Required for `RESOLUTION_ACCEPTED` / `RESOLUTION_REJECTED`.** |
| `descriptor_long_desc` | no | Message to the LSP (e.g. the info requested). |
| `images` | no | `[{ url, size_type? }]`. |

`202` → same shape as create. A transition the issue can't make (e.g. acting on a closed issue)
returns `409 ISSUE_STATE_INVALID`.

> **`resolution_id` caveat:** LSPs observed so far (including ONDC Workbench) reply in the
> IGM 1.0 shape. That shape has **one `resolution` object and no resolution id**, so
> `GET /logistics/issues/:issueId` shows the resolution but has no id to send back.
> `RESOLUTION_ACCEPTED` / `RESOLUTION_REJECTED` therefore can't be used against them. To accept,
> send `CLOSED`. To reject, send `ESCALATED` (allowed once the LSP has sent a `RESOLVED`
> action).

## Ask for the latest status: `POST /logistics/issue_status`

```json
{ "issue_id": "…" }
```

`202` → `{ "issueId", "transactionId", "messageId", "status": "ISSUE_STATUS_SENT" }`.
`409` = issue not found.

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
  "descriptorCode": "ITM004",
  "status": "OPEN",
  "level": "ISSUE",
  "shortDesc": "Quality issue",
  "longDesc": "The package arrived damaged.",
  "expectedResponseDuration": "PT2H",
  "expectedResolutionDuration": "P1D",
  "lastActionId": "A1",
  "resolution": {
    "actionTriggered": "REFUND",
    "shortDesc": "Refund to be initiated",
    "longDesc": "For this complaint, refund is to be initiated",
    "refundAmount": "59.00"
  },
  "refs": [{ "refId": "od260910a1b2c3d4", "refType": "ORDER" }, { "refId": "I1", "refType": "ITEM", "quantityCount": "1" }],
  "actors": [{ "actorId": "…", "actorType": "INTERFACING_NP", "orgName": "…", "personName": "…", "contactPhone": "…", "contactEmail": "…" }],
  "actions": [
    { "actionId": "A1", "code": "OPEN", "shortDesc": "Complaint created", "updatedAt": "2026-10-08T07:43:50.391Z", "actionBy": "…" },
    { "actionId": "respondent-0", "side": "respondent", "cascadedLevel": 1, "code": "PROCESSING", "shortDesc": "Complaint is being processed",
      "updatedAt": "2026-10-08T07:43:52.989Z", "actorOrgName": "workbench.ondc.tech::nic2004:60232", "actorPersonName": "Jane Doe",
      "actorPhone": "9450394140", "actorEmail": "respondentapp@respond.com" },
    { "actionId": "respondent-1", "side": "respondent", "cascadedLevel": 1, "code": "RESOLVED", "shortDesc": "Complaint resolved", "updatedAt": "2026-10-08T07:43:54.270Z" }
  ],
  "createdAt": "2026-10-08T07:43:50.391Z",
  "updatedAt": "2026-10-08T07:43:54.270Z"
}
```

- `status` (`OPEN` / `PROCESSING` / `RESOLVED` / `CLOSED`) changes when **you** act, or when an
  LSP callback includes `issue.status`. IGM 1.0 LSPs (e.g. Workbench) don't send it, so their
  progress shows **only in `actions`**. Drive the UI from the latest `side: "respondent"` action's
  `code` (e.g. `RESOLVED`), and fall back to `status`.
- `level`: `ISSUE` → `GRIEVANCE` (after `ESCALATED`).
- `resolution` is only present once the LSP has proposed or executed one.
- `actions` is the timeline, oldest first. Actions you sent have ids `A1`, `A2`, …. LSP actions
  have `side: "respondent"` and the contact details of whoever acted. `code` values include
  `OPEN`, `PROCESSING`, `INFO_REQUESTED`, `RESOLVED`, `CLOSED`, `ESCALATED`, and the
  `action_code` values you sent.
- Optional fields are omitted when empty.

`404 ISSUE_NOT_FOUND` · `500 ISSUE_DETAILS_FAILED`

## List an order's issues: `GET /logistics/orders/:orderId/issues`

`200` (newest first; `issues: []` when there are none, including for an unknown order):

```json
{
  "orderId": "od260910a1b2c3d4",
  "issues": [
    { "issueId": "iss261008b1fa4426", "categoryCode": "ITEM_QUALITY", "descriptorCode": "ITM004",
      "status": "OPEN", "level": "ISSUE", "lastActionId": "A1",
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

`newActionCount` is the number of new respondent actions in that callback. `0` means nothing
new happened. The events only tell you *which* issue changed. Fetch
`GET /logistics/issues/:issueId` to get the new status, actions and resolution.

## Errors

`400 INVALID_ISSUE_REQUEST` (bad body, unknown category, missing images, missing
`resolution_id`) · `409 ISSUE_STATE_INVALID` · `502 ONDC_NACK` / `ONDC_ACK_TIMEOUT` /
`ISSUE_SUBMISSION_FAILED` · `500 ISSUE_FAILED`.
