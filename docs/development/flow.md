 # Implement ONDC Logistics Init Connected to Search

  ## Summary

  Add a selection-based POST /logistics/init flow that uses a completed search and selected provider/item/fulfillment IDs to
  construct, persist, sign, and send an ONDC /init request.

  Also add /on_init callback handling so the init transaction can be tracked asynchronously.

  The implementation should target the existing ONDC Logistics 1.2.0 configuration and reuse the current transport, signing,
  transaction, and callback patterns. The official logistics reference implementation confirms /init and /on_init are part of
  the Logistics v1.2 flow. (ONDC reference logistics SDK (https://github.com/ONDC-Official/ref-logistics-app-sdk), ONDC
  logistics specifications (https://github.com/ONDC-Official/ONDC-LOG-Specifications))

  ## Key Changes

  ### 1. Add the client-facing init contract

  Create internal request types and validation for:

  - searchId
  - bppId
  - providerId
  - itemId
  - fulfillmentId
  - item quantity, defaulting to 1
  - billing/customer details
  - payment and settlement details required by the selected BPP

  The endpoint should be:

  POST /logistics/init

  Example response:

  {
    "initId": "uuid",
    "transactionId": "uuid",
    "messageId": "uuid",
    "status": "INIT_SENT"
  }

  The server must reject:

  - unknown searchId
  - provider not belonging to the search
  - item not belonging to the selected provider
  - fulfillment not belonging to the selected provider
  - missing BPP identity
  - invalid billing, quantity, or payment data
  - attempts to initialize a search that has no valid /on_search result

  ### 2. Hydrate the init request from search data

  Add an init repository that loads:

  - original search transaction and context
  - pickup and delivery locations
  - payload details
  - selected BPP ID and URI from the matching on_search callback
  - selected provider
  - selected item
  - selected fulfillment

  The client should provide selection identifiers, but the server must derive protocol data from persisted search data. This
  prevents clients from changing addresses, provider IDs, prices, or fulfillment data after /search.

  The selected BPP must be copied into the init context:

  context.action = "init";
  context.bpp_id = selectedBppId;
  context.bpp_uri = selectedBppUri;
  context.transaction_id = newUuid;
  context.message_id = newUuid;

  The original search transaction ID should not be reused. The new init transaction should reference the search transaction
  through a database relation or explicit parentTransactionId.

  ### 3. Add ONDC init mapping and transport support

  Create:

  - OndcInitRequest
  - OndcOnInitResponse
  - init mapper
  - sendInit() on OndcTransport
  - GatewayOndcTransport.sendInit()

  The mapper should build the ONDC order using:

  - selected provider ID
  - selected item ID and quantity
  - selected fulfillment ID
  - persisted start/end locations
  - persisted payload details where required
  - client-provided billing details
  - client-provided payment/settlement details
  - BPP identity from the selected search callback

  Reuse sendOndcRequest() so init requests receive the same signing, authorization header, logging, timeout, and gateway
  behavior as search.

  ### 4. Persist init transactions

  Extend the transaction schema/model to support parent-child flow tracking:

  search transaction
          ↓
  init transaction
          ↓
  on_init callback

  At minimum, persist:

  - action: init
  - transaction ID
  - message ID
  - parent search transaction ID
  - BAP/BPP context
  - request payload
  - status: pending, sent, failed, received, or completed
  - response payload
  - callback message ID and timestamp
  - error code/message

  Add an init-specific table only for init/order data that cannot safely live in the generic transaction payload, such as:

  - selected provider ID
  - selected item ID
  - selected fulfillment ID
  - quantity
  - billing details
  - payment details
  - resulting order/provider details from on_init

  For the first slice, retain the complete raw /init and /on_init payloads even if only a subset is normalized.

  ### 5. Add the init service and controller

  Implement an InitService that:

  1. Validates the client request.
  2. Loads and validates the selected search result.
  3. Creates a new init transaction and payload.
  4. Persists the transaction before sending.
  5. Sends signed /init to the selected BPP.
  6. Updates status to sent.
  7. Marks the transaction failed with a structured error if submission fails.
  8. Returns the init identifiers and INIT_SENT status.

  Follow the existing SearchService pattern so error handling and persistence behavior remain consistent.

  Add the route in src/routes/search.routes.ts or a separate order-flow route module, keeping the public path under /logistics.

  ### 6. Add /on_init callback processing

  Add:

  POST /on_init

  The callback handler should:

  - validate that context.action === "on_init"
  - require transaction_id
  - find the corresponding init transaction
  - persist the raw callback
  - update transaction status to received or completed
  - return an ONDC ACK response
  - return an ONDC NACK for malformed or unknown callbacks

  Use duplicate protection based on:

  transaction_id + message_id + bpp_id

  The callback should not create a new order if the same callback has already been processed.

  For this MVP, normalize only the essential init result:

  - order/provider ID
  - selected item and fulfillment data
  - quote/price if returned
  - payment/settlement details if returned
  - rejection/error information

  Keep all unmodeled fields in the raw response payload for later confirm, status, and cancel implementation.

  ## Test Plan

  Add unit tests for:

  - valid selection-based init request
  - missing required selection fields
  - unknown search ID
  - provider/item/fulfillment mismatch
  - BPP mismatch
  - correct init context construction
  - correct start/end location mapping
  - correct provider/item/fulfillment mapping
  - unique init transaction and message IDs
  - transaction persisted before outbound transport
  - successful outbound init status update
  - transport failure status update
  - malformed /on_init returning NACK
  - unknown init transaction returning context-error NACK
  - valid /on_init persistence and status update
  - duplicate /on_init callback being acknowledged without duplicate processing
  - authorization header being generated from the exact init payload

  Add an integration test with a fake OndcTransport that verifies the complete flow:

  search result → selected init request → persisted init transaction → outbound init

  ## Acceptance Criteria

  - A client can select a provider, item, and fulfillment from an existing search and trigger /init.
  - The server never trusts client-supplied provider or location data without validating it against the persisted search.
  - Outbound /init is signed and sent to the selected BPP.
  - Init transactions can be traced back to their originating search.
  - /on_init callbacks are validated, persisted, deduplicated, and acknowledged.
  - Existing /search and /on_search behavior remains unchanged.
  - npm run build succeeds and all init tests pass.

  ## Assumptions
  - The endpoint sends /init and handles /on_init in the same slice.
  - The client supplies billing and payment/settlement information because the current search model does not contain sufficient
  - Full confirm, on_confirm, status, and order lifecycle behavior remain out of scope.