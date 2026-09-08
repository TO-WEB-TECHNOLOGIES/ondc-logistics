# Skill: ONDC Logistics API Flow

## Purpose

Maintain a consistent mental model of the complete buyer-side logistics
transaction.

## Flow

``` text
Retail order context
      |
      v
/search
      |
      v
ACK/NACK
      |
      v
/on_search
      |
      v
catalog ingestion / selection
      |
      v
/init
      |
      v
ACK/NACK
      |
      v
/on_init
      |
      v
/confirm
      |
      v
ACK/NACK
      |
      v
/on_confirm
      |
      +----------------------+
      |                      |
      v                      v
/status                  /track
      |                      |
      v                      v
/on_status              /on_track
      |
      +-------> /update → /on_update
      |
      +-------> /cancel → /on_cancel
```

## Async processing

Callbacks are network events, not ordinary synchronous responses.

Preferred boundary:

`receive → verify → validate → correlate → durable stage/persist → process → publish`

Do not publish application-facing state before the authoritative
persistence boundary.

## Correlation

Always identify: - `transaction_id` - `message_id` - order ID where
applicable - provider ID - fulfillment ID - item ID

Do not correlate solely by a human-readable name or price.

## Duplicate delivery

Design callback processing to be idempotent.

Consider: - repeated callback, - lost ACK, - retried sender, - worker
crash, - stale callback, - callback arriving out of order.

## Search/catalog

`/search` expresses the buyer's intent.

`/on_search` supplies LSP catalog options.

Catalog data can include: - provider - provider locations - categories -
fulfillments - items - prices - TAT - distance - serviceability-related
information

Normalize these relationships without destroying the original IDs.

## Order construction

When selected catalog data becomes `/init`: - do not reconstruct objects
from memory if the selected catalog object already contains
authoritative values, - preserve IDs and selected relationships, -
explicitly map only the fields required by the target API.

## Post-order

State updates must be validated against the existing order and
fulfillment.

Never blindly overwrite an entire order with an arbitrary callback
payload if the application's persistence model requires controlled
field-level updates.
