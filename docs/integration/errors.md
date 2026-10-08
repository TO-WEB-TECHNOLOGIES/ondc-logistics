# Errors

Every non-2xx response from `/logistics/*` has this shape:

```json
{
  "error": {
    "code": "INVALID_INIT_REQUEST",
    "message": "Invalid ONDC init request",
    "details": [{ "path": "payment.settlement_details", "message": "is required and must be a non-empty array when payment.type is ON-FULFILLMENT" }]
  }
}
```

`details` is present on validation errors, and on ONDC errors (see below). Some `409`s carry a
top-level `error.path` instead.

## By HTTP status

| Status | Codes | Meaning | UI action |
|---|---|---|---|
| `400` | `INVALID_SEARCH_REQUEST`, `INVALID_INIT_REQUEST`, `INVALID_CONFIRM_REQUEST`, `INVALID_STATUS_REQUEST`, `INVALID_TRACK_REQUEST`, `INVALID_CANCEL_REQUEST`, `INVALID_UPDATE_REQUEST`, `INVALID_ISSUE_REQUEST` | Body failed validation | Highlight the field in `details[].path` (search: the field is named in `message`) |
| `404` | `SEARCH_NOT_FOUND`, `ORDER_NOT_FOUND`, `ISSUE_NOT_FOUND` (GET endpoints); `INIT_SUBMISSION_FAILED` on `/init` | Unknown id / no matching option | Go back to search results |
| `409` | `INIT_SUBMISSION_FAILED` (ambiguous option), `CONFIRM_STATE_INVALID`, `STATUS_STATE_INVALID`, `TRACK_STATE_INVALID`, `CANCEL_STATE_INVALID`, `UPDATE_STATE_INVALID`, `ISSUE_STATE_INVALID` | Request doesn't fit the current state (order not found, already cancelled, init not finished, fulfillment mismatch, …) | Show `message`; refresh state |
| `425` | `INIT_SUBMISSION_FAILED` | No `/on_search` received yet | Wait a moment and retry |
| `502` | `ONDC_NACK` | The LSP rejected the request synchronously | Show `details[0].ondcMessage` |
| `502` | `ONDC_ACK_TIMEOUT` | The LSP didn't answer (the backend already retried) | Offer "try again" |
| `502` | `*_SUBMISSION_FAILED` | Other failure sending to the network | Offer "try again" |
| `500` | `SEARCH_FAILED`, `INIT_FAILED`, `CONFIRM_FAILED`, `STATUS_FAILED`, `TRACK_FAILED`, `CANCEL_FAILED`, `UPDATE_FAILED`, `ISSUE_FAILED`, `SEARCH_OPTIONS_FAILED`, `ORDER_STATUS_FAILED`, `ORDER_TRACK_FAILED`, `ISSUE_DETAILS_FAILED`, `ORDER_ISSUES_FAILED` | Backend error | Generic error, retry later |

The init status code is what tells its cases apart: `404` (no match), `409` (ambiguous),
`425` (not ready) and `502` (send failed) all use the code `INIT_SUBMISSION_FAILED`.

## ONDC NACK details

```json
{
  "error": {
    "code": "ONDC_NACK",
    "message": "Counterparty NACKed /track",
    "details": [{ "ondcType": "DOMAIN-ERROR", "ondcCode": "60012", "ondcMessage": "Tracking not enabled", "ondcPath": null, "httpStatus": 200, "attempts": 1 }]
  }
}
```

```json
{
  "error": {
    "code": "ONDC_ACK_TIMEOUT",
    "message": "No ACK/NACK for /confirm after 3 attempt(s) of 15000ms",
    "details": [{ "attempts": 3, "timeoutMs": 15000, "last": "…" }]
  }
}
```

## Errors that arrive later (SSE)

An LSP can ACK the request and then report an error in its callback. That arrives as a
`*_error` event: `init_error`, `confirm_error`, `status_error`, `track_error`, `cancel_error`,
`update_error`, `issue_error` or `issue_status_error`. Each has `{ code, message }` (plus `orderId`/`issueId`).
`code` is the LSP's ONDC error code. Show `message` to the user. One to handle specially:

| Code | Meaning |
|---|---|
| `60012` | Tracking not available yet: the order isn't picked up, or tracking is disabled. Per the contract this normally comes as a sync NACK (`502 ONDC_NACK` on `/track`). |

(`62505`, `63001` and `63002` appear in backend logs. Those are codes the backend itself sends
back to LSPs, never something the frontend receives.)
