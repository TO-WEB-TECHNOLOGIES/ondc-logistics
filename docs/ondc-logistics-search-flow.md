# ONDC Logistics `/search` flow

## Architecture

```text
Client → POST /logistics/search → route → controller → SearchService
  ├─ application request → ONDC payload mapper
  ├─ DrizzleSearchRepository
  ├─ shared ONDC signing utility
  └─ shared ONDC HTTP utility → ONDC Gateway → logistics BPPs → /on_search
```

The existing application convention mounts the route at `POST /logistics/search`.
The controller parses and validates the application request. The service creates the
ONDC `transaction_id` and `message_id`, maps the request into the Logistics protocol
shape, persists the transaction and search intent, then submits the request. The
immediate response is a submission result; provider results arrive asynchronously via
`/on_search` and are not awaited by `/search`.

## Layers and payload

`SearchRequest` is the application model. `mapSearchRequestToOndc()` creates the
typed wire model with `context.action = "search"` and `message.intent` containing
category, fulfillment, locations, optional schedule, payload details, and payment.
The repository stores the raw outbound payload as JSONB as well as queryable search,
location, schedule, shipment, and payment fields.

`GatewayOndcTransport` is a small adapter. It delegates signing and HTTP delivery to
the existing `sendOndcRequest()` utility; it does not implement cryptography or use
Axios directly.

## Signing

The existing utility signs the exact serialized payload using this flow:

```text
payload → BLAKE-512 digest → signing string → Ed25519 private key → Authorization header
```

The header `keyId` is constructed as:
`subscriber_id|unique_key_id|ed25519`.
`subscriber_id` identifies the registered NP, `unique_key_id` selects its registered
public key, and the private key signs the request. Secret values and private keys are
never documented or persisted.

## Request lifecycle

1. The client calls `POST /logistics/search`.
2. The controller validates the body and returns a standard 400 response for invalid input.
3. The service creates transaction/message IDs and builds the ONDC payload.
4. The repository persists the transaction and search intent.
5. The signing utility generates the Authorization header.
6. The HTTP utility sends `POST /search` to the configured Gateway.
7. The transaction is marked `sent`, or `failed` with safe error metadata.
8. The API returns `{ searchId, transactionId, messageId, status: "SEARCH_SENT" }`.
9. ONDC routes the request to logistics BPPs.
10. The BAP later receives `/on_search`; callback persistence/result delivery is a separate asynchronous flow.

## Database state

`ondc_transactions` stores protocol IDs, action, context metadata, raw request payload,
submission status, timestamps, and safe error code/message fields. `logistics_searches`
links the transaction to the business search. Child tables store the start/end
locations, optional schedule and holidays, shipment payload, and payment requirement.
No Authorization header, private key, or credential is stored.
