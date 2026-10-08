# Init

Send the option the user picked, plus contacts, billing and payment details. The LSP answers
with a **quote** and **cancellation terms** to show before the user confirms.

## `POST /logistics/init`

```json
{
  "search_id": "c2b7…",
  "provider_id": "P1",
  "item_id": "I1",
  "fulfillment_id": "1",
  "pickup_contact": { "phone": "9000000000", "email": "store@example.com" },
  "delivery_contact": { "phone": "9111111111", "email": "buyer@example.com" },
  "billing": {
    "name": "Buyer Name",
    "email": "buyer@example.com",
    "phone": "9111111111",
    "tax_number": "GST123456",
    "created_at": "2026-09-10T08:00:00.000Z",
    "updated_at": "2026-09-10T08:00:00.000Z",
    "address": {
      "name": "Home", "building": "House 1", "locality": "Koramangala",
      "city": "Bengaluru", "state": "Karnataka", "country": "India", "area_code": "560001"
    }
  },
  "payment": {
    "type": "ON-ORDER",
    "collected_by": "BAP",
    "amount": "120.00",
    "currency": "INR",
    "settlement_details": [{
      "settlement_counterparty": "buyer-app",
      "settlement_type": "upi",
      "beneficiary_name": "Buyer App Pvt Ltd",
      "upi_address": "buyerapp@oksbi",
      "settlement_bank_account_no": "1234567890",
      "settlement_ifsc_code": "SBIN0000001"
    }]
  }
}
```

### Fields

| Field | Req. | Notes |
|---|---|---|
| `search_id` | yes | From `POST /logistics/search`. |
| `provider_id` | no | `provider.providerId` from `search_result`. |
| `item_id` | no | `provider.items[].catalogItemId` (SSE) / `items[].itemId` (options). |
| `fulfillment_id` | no | The item's `fulfillmentId`. |
| `bpp_id` | no | `bppId` from the options endpoint. Needed only when several LSPs returned the same ids. |
| `quantity` | no | Positive integer. |
| `pickup_contact`, `delivery_contact` | yes | `email` **required**, `phone` optional. |
| `billing.name/email/tax_number/created_at/updated_at` | yes | Timestamps are ISO-8601 strings. |
| `billing.phone` | no | |
| `billing.address.name/building/locality/city/state/country/area_code` | yes | Here `area_code` **is** inside `address` (unlike `/search`). `street` is optional. |
| `payment.type` | yes | `ON-ORDER` \| `ON-FULFILLMENT` \| `POST-FULFILLMENT`. |
| `payment.collected_by` | yes | `BAP` or `BPP`. |
| `payment.amount` | yes | String or number. |
| `payment.currency` | yes | e.g. `INR`. |
| `payment.settlement_details` | conditional | **Required, non-empty, when `type` is `ON-FULFILLMENT`.** Otherwise optional; omit it rather than sending `[]`. |

**How the option is chosen:** the backend looks at the stored `/on_search` results for `search_id`
and keeps the provider/item/fulfillment combinations that match whichever of `bpp_id`,
`provider_id`, `item_id` and `fulfillment_id` you sent. Exactly one combination must remain.
Always send `provider_id`, `item_id` and `fulfillment_id`; sending only `search_id` is usually
ambiguous.

Pickup/drop addresses and GPS are taken from the original search; you don't resend them.

### Response `202`

```json
{ "initId": "…", "transactionId": "a91e…", "messageId": "…", "status": "INIT_SENT" }
```

`transactionId` is the same as the search's. **Keep it: it is `initTransactionId` for `/confirm`.**

| Error | Meaning / UI action |
|---|---|
| `400 INVALID_INIT_REQUEST` | Bad field. `details[0].path` names it. |
| `404 INIT_SUBMISSION_FAILED` | No option matches the ids sent. |
| `409 INIT_SUBMISSION_FAILED` | Several options match. Send `bpp_id` / `fulfillment_id`. |
| `425 INIT_SUBMISSION_FAILED` | No `/on_search` received yet for this search. Wait and retry. |
| `502 ONDC_NACK` / `ONDC_ACK_TIMEOUT` | The LSP rejected the request or didn't answer. See `details`. |

## Async result: `init_result`

```json
{
  "event": "init_result",
  "transactionId": "a91e…",
  "providerId": "P1",
  "items": [{ "itemId": "I1", "name": "Standard Delivery", "fulfillmentId": "1", "quantityCount": 1 }],
  "fulfillments": [{ "fulfillmentId": "1", "type": "Delivery" }],
  "quote": { "priceAmount": "70.80", "priceCurrency": "INR", "ttl": "PT15M" },
  "quoteBreakups": [
    { "itemId": "I1", "titleType": "delivery", "priceAmount": "60.00", "priceCurrency": "INR" },
    { "itemId": "I1", "titleType": "tax", "priceAmount": "10.80", "priceCurrency": "INR" }
  ],
  "cancellationTerms": [
    { "fulfillmentStateCode": "Pending", "cancellationFeePercentage": "0", "cancellationFeeAmount": "0.00", "cancellationFeeCurrency": "INR" },
    { "fulfillmentStateCode": "Order-picked-up", "cancellationFeePercentage": "100", "cancellationFeeAmount": "70.80", "cancellationFeeCurrency": "INR" }
  ]
}
```

- `quote.priceAmount` is the total to show. `quote.ttl` is how long the quote is valid.
- `titleType` values: `delivery`, `rto`, `reverseqc`, `tax`, `diff`, `tax_diff`, `discount`.
- `cancellationTerms` give the fee per fulfillment state. Show them; confirming accepts them.

`init_error` → `{ code, message }`: the LSP refused (e.g. not serviceable). Let the user pick
another option.

Only enable "Confirm" after `init_result` has arrived. `/confirm` fails with `409` before that.
