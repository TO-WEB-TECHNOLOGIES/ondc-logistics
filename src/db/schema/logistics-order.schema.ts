import { decimal, index, integer, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

const timestampWithTimezone = (name: string) =>
  timestamp(name, { withTimezone: true });

// Confirmed-order storage (from /confirm onward). Flat typed columns only —
// no JSONB, no child tables. This means the table represents a single
// primary item and a single primary fulfillment per order (the common
// point-to-point logistics case), not true one-to-many arrays: a second
// item, fulfillment, or linked-order line isn't representable here.
// Tag-shaped data (order/fulfillment tags — e.g. the "state"/ready_to_ship
// tag) is NOT a column here; it's linked via the existing shared `tags`/
// `tag_values` tables (see shared.schema.ts's new `logisticsOrderId` owner
// column) instead of being duplicated as columns or JSON.
export const logisticsOrder = pgTable(
  "logistics_order",
  {
    orderId: varchar("order_id").primaryKey(), // generateOrderId() — see src/utils/order-id.ts
    // Plain indexed reference, no FK — matches how parent_transaction_id on
    // ondc_transactions is already a plain varchar joined by value.
    transactionId: varchar("transaction_id").notNull(),
    bppId: varchar("bpp_id"),
    bppUri: varchar("bpp_uri"),
    providerId: varchar("provider_id"),
    state: varchar("state"),
    orderCreatedAt: timestampWithTimezone("order_created_at"),
    orderUpdatedAt: timestampWithTimezone("order_updated_at"),

    // Cancellation lifecycle (see docs/ondc/ondc logistics.docx, "/cancel"/
    // "/on_cancel" sections). cancellationStatus tracks OUR outbound attempt
    // separately from `state`: "pending" once /cancel is sent, "succeeded"
    // only once /on_cancel confirms it (error-free, order.state === "Cancelled"),
    // "failed" on a transport error or an errored /on_cancel (NACK-like
    // rejection). `state` itself is only ever set to "Cancelled" on the
    // "succeeded" transition — never optimistically on send. cancellationReasonId
    // / cancelledBy are populated from the confirmed callback's
    // order.cancellation.{reason.id,cancelled_by} (cancelled_by distinguishes a
    // buyer-initiated vs LSP-initiated cancellation for audit/UI purposes).
    cancellationStatus: varchar("cancellation_status"),
    cancellationReasonId: varchar("cancellation_reason_id"),
    cancelledBy: varchar("cancelled_by"),

    // Item (single/primary item)
    itemId: varchar("item_id"),
    itemCategoryId: varchar("item_category_id"),
    // Fulfillment-type code (e.g. "P2P"/"P2H2P") — echoed on every /update
    // payload's items[].descriptor.code per the contract's example; distinct
    // from itemDescriptorName (a display name).
    itemDescriptorCode: varchar("item_descriptor_code"),
    itemDescriptorName: varchar("item_descriptor_name"),
    itemQuantityCount: integer("item_quantity_count"),

    // Fulfillment (single/primary fulfillment)
    fulfillmentId: varchar("fulfillment_id"),
    fulfillmentType: varchar("fulfillment_type"),
    awbNo: varchar("awb_no"),
    // Granular fulfillment-state code (Pending/Agent-assigned/Order-picked-up/
    // etc — see the contract's "Fulfillment states & mapping to order states"
    // table) — distinct from the coarser order-level `state` column above.
    // Populated by /on_confirm and /on_status.
    fulfillmentStateCode: varchar("fulfillment_state_code"),
    fulfillmentStateShortDesc: varchar("fulfillment_state_short_desc"),

    // Start/end instructions (PCC/DCC)
    startInstructionCode: varchar("start_instruction_code"),
    startInstructionShortDesc: varchar("start_instruction_short_desc"),
    startInstructionLongDesc: varchar("start_instruction_long_desc"),
    startInstructionImages: varchar("start_instruction_images").array(),
    endInstructionCode: varchar("end_instruction_code"),
    endInstructionShortDesc: varchar("end_instruction_short_desc"),
    endInstructionLongDesc: varchar("end_instruction_long_desc"),
    endInstructionImages: varchar("end_instruction_images").array(),

    // Authorization / OTP (start+end). type comes from /init|/confirm when
    // present; token/valid_from/valid_to are populated later by /update when
    // the frontend sends the OTP for pickup/delivery — not by /confirm.
    startAuthorizationType: varchar("start_authorization_type"),
    startAuthorizationToken: varchar("start_authorization_token"),
    startAuthorizationValidFrom: timestampWithTimezone(
      "start_authorization_valid_from",
    ),
    startAuthorizationValidTo: timestampWithTimezone(
      "start_authorization_valid_to",
    ),
    endAuthorizationType: varchar("end_authorization_type"),
    endAuthorizationToken: varchar("end_authorization_token"),
    endAuthorizationValidFrom: timestampWithTimezone(
      "end_authorization_valid_from",
    ),
    endAuthorizationValidTo: timestampWithTimezone("end_authorization_valid_to"),

    // Quote (total only — no per-line breakup without a child table)
    quotePriceAmount: decimal("quote_price_amount", { precision: 18, scale: 2 }),
    quotePriceCurrency: varchar("quote_price_currency"),

    // Billing (nullable — not every order carries billing)
    billingName: varchar("billing_name"),
    billingEmail: varchar("billing_email"),
    billingPhone: varchar("billing_phone"),

    // Payment (nullable — depends on payment type)
    paymentType: varchar("payment_type"),
    paymentCollectedBy: varchar("payment_collected_by"),
    paymentCollectionAmount: decimal("payment_collection_amount", {
      precision: 18,
      scale: 2,
    }),

    // Linked retail order (@ondc/org/linked_order) — id/product/weight/
    // dimensions/provider name, single representative linked item.
    linkedOrderRetailOrderId: varchar("linked_order_retail_order_id"),
    linkedOrderProductName: varchar("linked_order_product_name"),
    linkedOrderQuantityCount: integer("linked_order_quantity_count"),
    linkedOrderWeightUnit: varchar("linked_order_weight_unit"),
    linkedOrderWeightValue: decimal("linked_order_weight_value", {
      precision: 18,
      scale: 6,
    }),
    linkedOrderLengthUnit: varchar("linked_order_length_unit"),
    linkedOrderLengthValue: decimal("linked_order_length_value", {
      precision: 18,
      scale: 6,
    }),
    linkedOrderBreadthUnit: varchar("linked_order_breadth_unit"),
    linkedOrderBreadthValue: decimal("linked_order_breadth_value", {
      precision: 18,
      scale: 6,
    }),
    linkedOrderHeightUnit: varchar("linked_order_height_unit"),
    linkedOrderHeightValue: decimal("linked_order_height_value", {
      precision: 18,
      scale: 6,
    }),
    linkedOrderProviderName: varchar("linked_order_provider_name"),

    // Live-tracking snapshot (from /on_track — see docs/ondc/ondc logistics.docx,
    // "/on_track" section). Only the LATEST known position/status is kept —
    // the breadcrumb path (tags[code=path], a growing list) is deliberately
    // NOT persisted here (doesn't fit this table's flat-column, single-row
    // design); it's forwarded live via SSE only. See track.repository.ts.
    trackingUrl: varchar("tracking_url"),
    trackingStatus: varchar("tracking_status"),
    trackingGps: varchar("tracking_gps"),
    trackingLocationTimestamp: timestampWithTimezone("tracking_location_timestamp"),
    trackingUpdatedAt: timestampWithTimezone("tracking_updated_at"),

    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
    updatedAt: timestampWithTimezone("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("logistics_order_transaction_id_idx").on(table.transactionId),
  ],
);
