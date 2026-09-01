# Plan: Implement on_search() Catalog Ingestion

## Summary

Build on_search() as an asynchronous webhook-to-worker pipeline:

1. Verify and validate the callback.
2. Persist the raw payload in staging.
3. Publish a staging reference to the catalog worker.
4. ACK immediately after durable staging.
5. Worker correlates the callback to /search, upserts normalized logistics catalog data, updates transaction state, and
   publishes SSE events.

Support paginated callbacks, duplicate delivery, and incremental updates safely.

## Key Changes

- Replace the current NotImplementedError service with injected interfaces for:
  - callback signature verification;
  - staging persistence;
  - catalog ingestion;
  - transaction correlation/status updates;
  - SSE publication and search TTL completion.

- Update callback validation to enforce contract-critical fields:
  - context.action = "on_search";
  - transaction/message IDs;
  - ONDC context consistency;
  - BPP identity;
  - provider IDs and provider catalog structure;
  - valid timestamps and required logistics catalog relationships.

- Return proper ONDC responses:
  - ACK after successful durable staging;
  - NACK for invalid signatures, malformed payloads, or unknown correlation where appropriate;
  - HTTP errors only for infrastructure failures that prevent durable acceptance.

- Add idempotency using (transaction_id, message_id, bpp_id) or an equivalent unique callback key. Duplicate callbacks must
  ACK without duplicating catalog rows or SSE events.

- Correlate callbacks to the originating ondc_transactions row using transaction_id and action = "search". Store:
  - BPP ID/URI;
  - callback message ID and timestamp;
  - complete raw response payload;
  - transaction status and processing metadata.

- Implement normalized ingestion for the existing logistics model:
  - providers;
  - categories;
  - fulfillments;
  - locations;
  - catalog items;
  - static terms;
  - parent/customization relationships where present.

- Resolve external item IDs before writing internal foreign keys. Correct the current parent-item relationship design so
  incoming ONDC string IDs cannot be written directly into UUID foreign-key columns.

- Apply timestamp-aware updates for incremental callbacks. Older catalog records must not overwrite newer records.
- Handle provider disable events by marking the provider’s catalog inactive rather than deleting historical data.
- Publish one normalized search_result SSE event per accepted provider, routed by the originating searchId.
- Keep the SSE stream open for the configured search TTL, allowing multiple provider/page callbacks. After the TTL expires,
  emit search_completed with reason: "completed" or "timeout" according to the final transaction state.

- Preserve the raw callback in staging and the transaction response payload for replay, audit, and failure recovery.

## Interfaces and Data Changes

Add or extend interfaces for:

- OnSearchStagingRepository
- CatalogIngestionService
- OnSearchCallbackRepository
- SearchLifecycleManager
- OnSearchSignatureVerifier

Extend transaction/catalog persistence with:

- callback idempotency key;
- raw callback payload;
- processing status and error details;
- BPP metadata;
- catalog version timestamps;
- active/disabled state where missing from the current schema.

Add indexes/unique constraints for:

- transaction ID + callback message ID + BPP ID;
- provider ID within a catalog/search context;
- catalog item ID within a provider;
- catalog version timestamps.

## Test Plan

Cover:

- valid callback with one provider;
- multiple paginated callbacks for one search;
- duplicate callback delivery;
- callback with unknown transaction ID;
- invalid signature;
- malformed provider/item payload;
- disabled provider;
- stale incremental update;
- newer incremental update;
- parent item/customization mapping;
- database rollback when one provider fails;
- ACK only after staging succeeds;
- SSE event publication and TTL completion;
- worker retry/replay from staging;
- raw payload and transaction response persistence.

## Assumptions

- The webhook/worker architecture is the target implementation.
- The first milestone persists normalized catalog data and publishes SSE results.
- Contract-critical validation is strict; optional ONDC fields remain optional.
- Search completion uses the outbound search TTL window.
- Raw callbacks are retained both in staging and on the correlated transaction.
- Existing lsp_* tables remain the foundation, with migrations added where their current types or fields cannot represent
  ONDC IDs and lifecycle state.
