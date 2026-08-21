---
name: hdfc-payment-gateway
description: Integrate HDFC SmartGateway (Juspay Express Checkout SDK) into the ONDC F&B BAP for collecting buyer payments between `/on_init` and `/confirm`. Use this skill whenever the user mentions payment gateway, HDFC, Juspay, SmartGateway, implementing payment collection, building the `/confirm` payment object, creating a payment session, handling HDFC webhooks (ORDER_CREATED, ORDER_SUCCEEDED, ORDER_FAILED, ORDER_REFUNDED, etc.), or integrating `expresscheckout-nodejs`. This project uses BAP-collected ON-ORDER payments only — always trigger this skill for any payment integration work.
---

# HDFC SmartGateway Integration — ONDC F&B BAP

## Project Context

This is an ONDC F&B Buyer NP (BAP) for domain `ONDC:RET11`. Payment is **always BAP-collected** (`collected_by: "BAP"`, `type: "ON-ORDER"`). The payment gateway integration happens **automatically** after `/on_init` is received from the BPP.

**Key difference from typical integrations**: The payment session is created **automatically** by the BFF (not called by the frontend) immediately after `/on_init` is received. The `payment_url` is pushed to the frontend via SSE. No polling needed.

---

## Payment Flow

### Browser Redirect Path (Buyer-facing)

```
BPP /on_init webhook
    │
    ▼
processOnInit() — saves to PG, pushes on_init via SSE
    │
    ├─► pushSSEvent("on_init", {...})     ──► Frontend receives on_init
    │
    └─► fire-and-forget: createHdfcSession()  (async)
              │
              ├─► Read frozen quote from PG
              ├─► juspay.orderSession.create()
              ├─► Upsert pg_transaction (PENDING)
              │
              ├─► on success: pushSSEvent("payment_url", {...})
              │            ──► Frontend receives session_url → redirects buyer to HDFC
              │
              └─► on error: pushSSEvent("payment_error", {...})
                           ──► Frontend receives error → shows message, closes SSE

HDFC SmartGateway redirect
    │
    ▼
/payment/callback?order_id=hdfc_order_id
    │
    ├─► checkPaymentStatus(order_id)   — verifies via juspay.order.status()
    ├─► Update pg_transaction (CHARGED / FAILED)
    └─► pushSSEvent("payment_status", {...})
              ──► Frontend receives CHARGED → proceeds to /confirm
```

### HDFC Server-to-Server Webhook Path

HDFC SmartGateway also sends **server-to-server webhook POSTs** to notify your server of order events. These are critical for reliability — browser redirects can fail on poor connections.

```
HDFC SmartGateway
    │
    ▼  POST /payment/hdfc-webhook  (Basic Auth: username:password)
    │
    ├─► Extract event_name (ORDER_CREATED, ORDER_SUCCEEDED, ORDER_FAILED, ORDER_REFUNDED, etc.)
    ├─► Parse full order object from body.content.order
    ├─► Map HDFC status to pgPaymentStatus
    ├─► Upsert pg_transaction
    └─► Push SSE event to frontend (payment_status)
```

**HDFC sends these webhook event types:**

| HDFC Event | Meaning | Required |
|---|---|---|
| `ORDER_CREATED` | Order created in HDFC system | Yes |
| `ORDER_SUCCEEDED` | Payment successful (CHARGED) | Yes |
| `ORDER_FAILED` | Payment failed | Yes |
| `ORDER_REFUNDED` | Refund successful | If refunds integrated |
| `ORDER_REFUND_FAILED` | Refund failed | If refunds integrated |
| `ORDER_AUTHORIZED` | Pre-Auth complete (for EMI/capture flow) | For pre-auth |

---

## SSE Events Emitted

The SSE stream (opened at `/select` time) receives two new event types after `/on_init`:

### `payment_url` — pushed when session creation succeeds

```json
{
  "event": "payment_url",
  "transaction_id": "uuid",
  "session_url": "https://smartgateway.hdfcuat.bank.in/...",
  "order_id": "uuid",
  "amount": "264.00",
  "currency": "INR"
}
```
Frontend action: redirect buyer to `session_url`.

### `payment_error` — pushed when session creation fails

Emitted when `createHdfcSession` cannot create a Juspay session (misconfiguration, API error, missing `payment_page_url`). The frontend receives this instead of `payment_url`.

```json
{
  "event": "payment_error",
  "transaction_id": "uuid",
  "error_code": "MISSING_PAYMENT_URL",
  "message": "Payment gateway did not return a session URL. Please try again.",
  "retryable": true
}
```

Frontend action:
- `retryable: true` → show error message with retry button; retry via `POST /payment/retry/:id`
- `retryable: false` → show error; do not offer retry (configuration issue — fix backend)

**Error codes:**

| `error_code` | Cause | `retryable` |
|---|---|---|
| `JUSPAY_API_ERROR` | Missing `HDFC_PAYMENT_PAGE_CLIENT_ID` or other config/API failure | `false` |
| `JUSPAY_NULL_RESPONSE` | Juspay returned empty response | `true` |
| `MISSING_PAYMENT_URL` | Juspay response missing `payment_page_url` | `true` |
| `SESSION_CREATE_ERROR` | Unexpected error (no `/on_init` record, etc.) | `true` |

### `payment_status` — pushed when HDFC notifies (webhook or redirect)

```json
{
  "event": "payment_status",
  "transaction_id": "uuid",
  "status": "CHARGED",
  "pg_txn_id": "hdfc_txn_123",
  "message": "Payment completed successfully",
  "event_type": "ORDER_SUCCEEDED"
}
```

Frontend action:
- `CHARGED` → proceed to `/confirm` with `pg_txn_id`
- `AUTHORIZED` → show pending UI; wait for `CHARGED` (pre-auth awaiting capture)
- Any other status → show error to buyer, offer retry via `POST /payment/retry/:id`

---

## Files

| File | Purpose |
|------|---------|
| `src/db/schema/pg-transaction.schema.ts` | `pgTransactionTable` — PG session lifecycle, FK → `ondc_on_init` |
| `src/db/schema/enums.ts` | `pgPaymentStatusEnum` — PENDING, CHARGED, AUTHENTICATION_FAILED, AUTHORIZED, etc. |
| `src/utils/payment/hdfc-client.ts` | Juspay SDK singleton with JWE auth, sandbox/prod URLs |
| `src/utils/order-logger.ts` | Per-order file logging — `orderLogger` (to `logs/{hdfcOrderId}.log`) and `saveOrderJsonFile` (to `logs/{hdfcOrderId}/order.json`) |
| `src/services/payment.service.ts` | `createHdfcSession`, `handlePaymentCallback`, `checkPaymentStatusFromHdfc`, `retryPaymentSession`, `handleHdfcWebhook`, `getPaymentFullStatus` |
| `src/controllers/payment.controller.ts` | `paymentCallback`, `getPaymentStatus`, `retryPayment`, `hdfcWebhook`, `getPaymentFullStatusController` |
| `src/routes/payment.routes.ts` | Route registration |
| `src/services/init.service.ts` | Calls `createHdfcSession` after `pushSSEvent("on_init", ...)` |

---

## Schema: `pg_transaction`

Linked to `ondc_on_init` via `onInitId` FK (one PG record per ONDC order session).

```sql
pg_transaction
  id                    uuid PK
  onInitId              uuid FK → ondc_on_init(id)
  transactionId          varchar(100) UNIQUE  -- ONDC transaction_id = Juspay order_id
  juspayOrderId         varchar(100)         -- same as transactionId
  hdfcOrderId           varchar(100)        -- HDFC's own orderId (from session response)
  amount                varchar(20)          -- MUST match on_init.quote.price.value
  currency              varchar(10)          -- default INR
  paymentPageUrl        text                 -- HDFC encrypted URL to redirect buyer
  sessionInitiated      boolean              -- set true before SSE push
  status                pg_payment_status    -- PENDING | CHARGED | AUTHENTICATION_FAILED | etc.
  statusMessage         text
  callbackPayloadJson   jsonb                -- raw HDFC callback for audit
  pgTxnId               varchar(100)        -- HDFC's own txn reference (for /confirm)
  sessionCreatedAt      timestamp
  callbackReceivedAt    timestamp
  statusCheckedAt        timestamp
  retryCount             integer default 0
  lastError              text
  createdAt             timestamp
  updatedAt             timestamp
```

Indexes: `transactionId` (unique), `onInitId`, `juspayOrderId`, `hdfcOrderId`, `status`.

---

## HDFC Webhook Endpoint

### POST /payment/hdfc-webhook

**Authentication**: HTTP Basic Auth — `Authorization: Basic base64(username:password)`

**HDFC sends this as a server-to-server POST** (not a browser redirect). The webhook payload structure:

```json
{
  "id": "evt_V2_3e3421673f274cb0ac682e6f4af54870",
  "date_created": "2025-10-27T10:37:56Z",
  "content": {
    "order": {
      "id": "ordeh_2fbab9a82f14447eaa397f533dc8f1d4",
      "order_id": "testupi-1",
      "status": "NEW",
      "status_id": 10,
      "amount": 1,
      "currency": "INR",
      "txn_id": "34436-testupi-2-5",
      "txn_uuid": "mozs9mSsE9B7sqsto7k",
      "payment_method": "UPI_COLLECT",
      "payment_method_type": "UPI",
      "payer_vpa": "success@upi",
      "customer_email": null,
      "customer_phone": null,
      "merchant_id": "34436",
      "bank_error_code": "",
      "bank_error_message": "",
      "resp_code": null,
      "resp_message": null,
      "gateway_id": 501,
      "refunded": false,
      "amount_refunded": 0,
      "maximum_eligible_refund_amount": 1,
      "refunds": [
        {
          "id": null,
          "unique_request_id": "erf_b0c764a743c4221b",
          "status": "SUCCESS",
          "refund_type": "STANDARD",
          "error_code": "00",
          "error_message": "Refund Success",
          "amount": 5,
          "ref": "55430487",
          "pg_processed_at": "FILTERED",
          "sent_to_gateway": true,
          "refund_source": "DUMMY",
          "initiated_by": "ms",
          "created": "2023-08-10T07:22:01Z"
        }
      ],
      "card": { ... },
      "emi_details": { ... },
      "payment_gateway_response": {
        "txn_id": "34436-testupi-2-5",
        "rrn": "101804313999",
        "resp_code": "00",
        "resp_message": "Transaction success",
        "auth_id_code": "NA",
        "epg_txn_id": "146127018902"
      }
    }
  },
  "event_name": "ORDER_SUCCEEDED"
}
```

### Webhook Response Requirements

**Return HTTP 200 immediately** after validating auth and parsing the event. Do NOT wait for full processing — return 200 fast, then process asynchronously.

If you return non-200, HDFC will **retry the webhook** until it gets 200.

### Mapping HDFC Events to PG Status

```typescript
function mapHdfcEventToStatus(eventName: string, orderStatus: string): PgPaymentStatus {
  switch (eventName) {
    case "ORDER_CREATED":
      return "PENDING";
    case "ORDER_SUCCEEDED":
      return "CHARGED";
    case "ORDER_FAILED":
      return orderStatus === "AUTHENTICATION_FAILED"
        ? "AUTHENTICATION_FAILED"
        : "AUTHORIZATION_FAILED";
    case "ORDER_REFUNDED":
      return "REFUNDED";
    case "ORDER_REFUND_FAILED":
      return "REFUND_PENDING"; // or a custom REFUND_FAILED status
    case "ORDER_AUTHORIZED":
      return "AUTHORIZED"; // for pre-auth flows
    default:
      return "PENDING";
  }
}
```

### Webhook Security

1. **Validate Basic Auth** — decode `Authorization: Basic <base64>` header, check username/password match configured values
2. **Verify idempotency** — use `id` field (evt_V2_...) to detect duplicate webhook deliveries
3. **Return 200 fast** — don't wait for DB writes; process asynchronously
4. **Log everything** — store full raw payload in `callbackPayloadJson` for audit

### Per-Order Physical File Logging

Every HDFC order gets its own physical log files (supplementing `logs/app.log`):

```
logs/{hdfcOrderId}/
  order.json              ← complete raw HDFC order object (overwritten each event)
  {hdfcOrderId}.log       ← per-event append log (same format as app.log)
```

- `order.json`: the complete raw HDFC order object sent in each webhook event. Overwritten on every event.
- `{hdfcOrderId}.log`: per-event log lines in the same format as `app.log` — written to stdout/stderr for PM2 capture.

Written by `orderLogger` (`src/utils/order-logger.ts`).

---

## Key Design Decisions

### Auto-created via SSE, not by frontend
`createHdfcSession` is called automatically from `processOnInit` (fire-and-forget). The frontend does NOT call any payment endpoint to start the flow — it just listens on the SSE stream.

### `transaction_id` as Juspay `order_id`
No mapping table needed — ONDC `transaction_id` IS the Juspay `order_id`. HDFC status check and `/confirm` payment both use this same ID.

### ONDC amount is always authoritative
`pg_transaction.amount` is set from `on_init.quote.price.value` (read from PG). HDFC is told this exact amount. If HDFC ever returns a different amount, reject and alert.

### Errors are stored and pushed via SSE
`createHdfcSession` is fire-and-forget. Errors go to `pg_transaction.lastError` AND a `payment_error` SSE event is pushed immediately to notify the frontend. A failed session does NOT crash the webhook or affect the `on_init` SSE push. Buyer can retry via `POST /payment/retry/:id`.

### Callback is idempotent
`pg_transaction` is upserted by `transactionId`. Duplicate HDFC callbacks are handled safely — the record is updated but no duplicate rows.

### `payment.callbackPayloadJson` for audit
The full raw callback from HDFC is stored as JSONB, regardless of format (form-encoded or JSON). This is critical for reconciliation disputes.

---

## Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/payment/callback` | None | HDFC redirects buyer here after payment (browser) |
| POST | `/payment/callback` | None | HDFC may POST form-encoded |
| POST | `/payment/hdfc-webhook` | Basic Auth | HDFC server-to-server webhook (ORDER_CREATED, ORDER_SUCCEEDED, etc.) |
| GET | `/payment/status/:transactionId` | JWT | Manual status poll by ONDC transaction ID (fallback) |
| GET | `/payment/full-status/:identifier` | JWT | Dual-inquiry status — accepts transactionId, hdfcOrderId, or juspayOrderId |
| POST | `/payment/retry/:transactionId` | JWT | Retry failed payment (idempotent) |

---

## Integration with `/confirm`

When the `payment_status` SSE event shows `CHARGED`, the frontend proceeds to `/confirm`.

The `/confirm` payment object uses:
- `paid_amount`: from `on_init.quote.price.value` (stored in `pg_transaction.amount`)
- `transaction_id`: `pg_txn_id` from the `payment_status` event (HDFC's reference)

```typescript
// /confirm payment object
{
  "@ondc/org/buyer_app_finder_fee_type": "percent",
  "@ondc/org/buyer_app_finder_fee_amount": "3",
  "type": "ON-ORDER",
  "paid_amount": pg_transaction.amount,      // from on_init.quote.price.value
  "status": "PAID",
  "transaction_id": payment_status.pg_txn_id, // HDFC's reference, NOT ONDC txn_id
  "collected_by": "BAP"
}
```

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| `createHdfcSession` fails | Error stored in `pg_transaction.lastError`. `payment_error` SSE pushed immediately. Frontend shows error with retry option (if retryable). Buyer can retry via `POST /payment/retry`. |
| HDFC webhook received with `ORDER_FAILED` | Push failure via SSE. Buyer retries via `POST /payment/retry/:id` (same `transaction_id`, idempotent). |
| HDFC webhook received with `ORDER_SUCCEEDED` | Push success via SSE. Frontend proceeds to `/confirm`. Auto-confirm triggered. |
| HDFC callback not received in ~5min | No automatic action. Buyer contacts support. (A cron to expire stale sessions can be added.) |
| `payment_status` = `AUTHENTICATION_FAILED` or `AUTHORIZATION_FAILED` | Push failure via SSE. Buyer retries via `POST /payment/retry/:id` (same `transaction_id`, idempotent). |
| `payment_status` = `CHARGED` | Push success via SSE. Frontend proceeds to `/confirm`. |
| `/confirm` NACK after `CHARGED` | Do NOT refund. Retry `/confirm` up to 3 times. If still failing, escalate via IGM. |

---

## Environment Variables

```env
# HDFC SmartGateway (Juspay Express Checkout)
HDFC_MERCHANT_ID=YOUR_MERCHANT_ID
HDFC_KEY_UUID=YOUR_KEY_UUID
HDFC_PRIVATE_KEY_PATH=/path/to/ondc-api/keys/privateKey.pem
HDFC_PUBLIC_KEY_PATH=/path/to/ondc-api/keys/public-key.pem
HDFC_PAYMENT_PAGE_CLIENT_ID=YOUR_PAYMENT_PAGE_CLIENT_ID
BFF_PUBLIC_URL=https://your-bff-domain.com    # for callback return URL

# HDFC Webhook Authentication (Basic Auth)
HDFC_WEBHOOK_USERNAME=your_webhook_username
HDFC_WEBHOOK_PASSWORD=your_webhook_password
```

> **Sandbox**: `https://smartgateway.hdfcuat.bank.in` — use for development (`NODE_ENV=development`).
> **Production**: `https://smartgateway.hdfc.bank.in` — set `NODE_ENV=production`.

---

## Implementation Reference

Read these files for the authoritative implementation:

| File | Key function |
|------|-------------|
| `src/services/payment.service.ts` | `createHdfcSession()` — reads quote, calls Juspay, upserts PG, pushes SSE |
| `src/services/payment.service.ts` | `handlePaymentCallback()` — verifies with HDFC, updates PG, pushes SSE |
| `src/services/payment.service.ts` | `handleHdfcWebhook()` — processes ORDER_CREATED, ORDER_SUCCEEDED, ORDER_FAILED, ORDER_REFUNDED events from HDFC server webhooks |
| `src/services/payment.service.ts` | `getPaymentFullStatus()` — dual-inquiry status: DB first, then HDFC backend for pending states |
| `src/services/init.service.ts` | `processOnInit()` — calls `createHdfcSession` after `pushSSEvent("on_init")` |
| `src/controllers/payment.controller.ts` | `paymentCallback()` — handles HDFC redirect/POST |
| `src/controllers/payment.controller.ts` | `hdfcWebhook()` — handles HDFC server-to-server webhook POST |
| `src/controllers/payment.controller.ts` | `getPaymentFullStatusController()` — `GET /payment/full-status/:identifier` |
| `src/db/schema/pg-transaction.schema.ts` | Full schema with FK → `ondc_on_init` |
| `src/utils/sse-manager.ts` | `pushSSEvent()` — pushes SSE events to frontend |
| `src/utils/order-logger.ts` | `orderLogger`, `saveOrderJsonFile` — per-order file logging |