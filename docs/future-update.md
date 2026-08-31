• Create a file named ONDC_SIMPLIFIED_API_CONTEXT.md with this content:

  # ONDC Logistics Simplified API Context

  ## Objective

  Expose simple application APIs for `/search`, `/init`, and `/confirm`. The client sends only business-level fields.
  The backend retrieves persisted state, builds the complete ONDC payload, validates it, signs it, sends it to the LSP/
  BPP, and persists the request/response.

  ## Flow

  /search → on_search state → /init → on_init state → /confirm → on_confirm

  Use the same ONDC `transaction_id` across `/search`, `/init`, and `/confirm`.

  Use a unique `message_id` for every API interaction.

  ## Public Application APIs

  ### POST /search

  Example request:

  ```json
  {
    "pickup": {
      "gps": "12.9716,77.5946",
      "area_code": "560001"
    },
    "drop": {
      "gps": "12.9352,77.6245",
      "area_code": "560034"
    },
    "package": {
      "category": "Immediate Delivery",
      "weight": "1.0"
    }
  }

  The backend generates:

  - transaction_id
  - message_id
  - ONDC context
  - complete ONDC /search payload

  Persist the generated transaction and outbound request.

  ### POST /init

  Example request:

  {
    "searchTransactionId": "T1",
    "providerId": "P1",
    "providerLocationId": "L1",
    "itemId": "I1",
    "fulfillmentId": "1"
  }

  The backend must:

  1. Load the /on_search state using searchTransactionId.
  2. Validate the selected provider, location, item, and fulfillment.
  3. Build the complete ONDC /init payload.
  4. Preserve the same transaction_id.
  5. Generate a new message_id.
  6. Persist the /init state and outbound request.

  ### POST /confirm

  Example request:

  {
    "initTransactionId": "T1",
    "orderId": "O2",
    "messageId": "M3"
  }

  The backend must:

  1. Validate initTransactionId.
  2. Load the persisted /init state.
  3. Preserve the ONDC transaction_id from /init.
  4. Generate or validate a new confirm message_id.
  5. Preserve the order ID.
  6. Use the provider, item, fulfillment, quote, billing, payment, and linked order from /init.
  7. Do not allow arbitrary quote manipulation.
  8. Build the complete ONDC /confirm payload.
  9. Sign and send it to the LSP/BPP.
  10. Persist the outbound request and response.
  11. Make retries idempotent.

  ## Internal Architecture

  Controller
    ↓
  Validate minimal application request
    ↓
  Load persisted transaction state
    ↓
  Validate state relationships
    ↓
  Build ONDC payload
    ↓
  Validate ONDC payload
    ↓
  Sign request
    ↓
  Send to LSP/BPP
    ↓
  Persist request/response

  Recommended components:

  - searchController
  - initController
  - confirmController
  - searchService
  - initService
  - confirmService
  - transactionRepository
  - ondcPayloadBuilder
  - ondcSchemaValidator
  - requestSigner
  - idempotencyRepository

  ## Important Rules

  - Application request types must be separate from ONDC request types.
  - Internal fields such as initTransactionId and searchTransactionId must never be forwarded to ONDC.
  - Do not derive transaction correlation from arbitrary order fields.
  - Do not generate a new transaction_id during /init or /confirm.
  - Do not generate a new order ID during /confirm.
  - Quote from /on_init is frozen until /confirm.
  - Do not use empty placeholders for required ONDC objects.
  - Persist the exact generated ONDC payload for debugging.
  - Log incoming, persisted, and reconstructed values when validation fails.
  - Return application-friendly errors while sending only ONDC-compliant error fields externally.
  - /confirm and /on_confirm must be idempotent.

  ## Validation

  Validate:

  - request identifiers
  - transaction_id continuity
  - unique message_id
  - provider ID
  - provider location ID
  - item ID
  - item fulfillment_id
  - item category_id
  - fulfillment ID and type
  - quote and quote breakup
  - billing
  - payment
  - linked order
  - order ID and state

  The backend must compare confirm data with persisted /init data before sending the request.

  ## Runtime Design

  Do not use an LLM to construct payloads at runtime.

  Payload generation should be deterministic application code. LLMs may be used during development for code assistance,
  debugging, or schema mapping, but not for production request generation.

  ## Success Criteria

  The system is complete when:

  1. Clients can call /search, /init, and /confirm using minimal request bodies.
  2. The backend creates valid ONDC payloads internally.
  3. Transaction continuity is preserved.
  4. Quotes and order data cannot be tampered with between stages.
  5. Requests are signed and persisted.
  6. Retries do not create duplicate operations.
  7. ONDC validation errors are correctly sanitized.


  This file can be reused as project context in a later session or provided to another developer/agent.