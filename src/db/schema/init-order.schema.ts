import {
  boolean,
  decimal,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { ondcTransactions } from "./ondc-transactions.schema.js";

const timestampWithTimezone = (name: string) =>
  timestamp(name, { withTimezone: true });

// One row per (transaction, snapshot). snapshotType separates what we sent
// in /init from what the BPP returned in /on_init, so a field missing in
// /on_init can be told apart from a field the BPP explicitly cleared.
//
// provider.locations[] lives in the shared `provider_locations` table
// (keyed by init_order_row_id); order-level tags live in the shared `tags`
// table (keyed by init_order_id) — see shared.schema.ts. linked_order's
// scalar fields are flattened onto this row since it's 1:1 per snapshot;
// only its item lines need a child table (init_order_linked_order_items).
export const initOrders = pgTable(
  "init_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    transactionDbId: uuid("transaction_db_id")
      .notNull()
      .references(() => ondcTransactions.id, { onDelete: "cascade" }),
    snapshotType: varchar("snapshot_type").notNull(), // 'init' | 'on_init'
    bppId: varchar("bpp_id"),
    bppUri: varchar("bpp_uri"),
    providerId: varchar("provider_id"),

    billingName: varchar("billing_name"),
    billingEmail: varchar("billing_email"),
    billingPhone: varchar("billing_phone"),
    billingTaxNumber: varchar("billing_tax_number"),
    billingCreatedAt: timestampWithTimezone("billing_created_at"),
    billingUpdatedAt: timestampWithTimezone("billing_updated_at"),
    billingAddressName: varchar("billing_address_name"),
    billingAddressBuilding: varchar("billing_address_building"),
    billingAddressLocality: varchar("billing_address_locality"),
    billingAddressStreet: varchar("billing_address_street"),
    billingAddressCity: varchar("billing_address_city"),
    billingAddressState: varchar("billing_address_state"),
    billingAddressCountry: varchar("billing_address_country"),
    billingAddressAreaCode: varchar("billing_address_area_code"),

    paymentType: varchar("payment_type"),
    paymentCollectedBy: varchar("payment_collected_by"),
    paymentCollectionAmount: decimal("payment_collection_amount", {
      precision: 18,
      scale: 2,
    }),
    // Internal-only: captured from the /init request for completeness even
    // though the ONDC payload's collection_amount carries no currency field.
    paymentCurrency: varchar("payment_currency"),

    quotePriceAmount: decimal("quote_price_amount", {
      precision: 18,
      scale: 2,
    }),
    quotePriceCurrency: varchar("quote_price_currency"),
    quoteTtl: varchar("quote_ttl"),

    orderCreatedAt: timestampWithTimezone("order_created_at"),
    orderUpdatedAt: timestampWithTimezone("order_updated_at"),

    // "@ondc/org/linked_order" scalar fields (1:1 with this snapshot).
    linkedOrderRetailOrderId: varchar("linked_order_retail_order_id"),
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
    linkedOrderProviderDescriptorName: varchar(
      "linked_order_provider_descriptor_name",
    ),
    linkedOrderProviderAddressName: varchar("linked_order_provider_address_name"),
    linkedOrderProviderAddressBuilding: varchar(
      "linked_order_provider_address_building",
    ),
    linkedOrderProviderAddressLocality: varchar(
      "linked_order_provider_address_locality",
    ),
    linkedOrderProviderAddressCity: varchar("linked_order_provider_address_city"),
    linkedOrderProviderAddressState: varchar(
      "linked_order_provider_address_state",
    ),
    linkedOrderProviderAddressAreaCode: varchar(
      "linked_order_provider_address_area_code",
    ),

    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
    updatedAt: timestampWithTimezone("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("init_orders_transaction_snapshot_idx").on(
      table.transactionDbId,
      table.snapshotType,
    ),
    index("init_orders_transaction_db_id_idx").on(table.transactionDbId),
  ],
);

export const initOrderItems = pgTable(
  "init_order_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    initOrderId: uuid("init_order_id")
      .notNull()
      .references(() => initOrders.id, { onDelete: "cascade" }),
    itemId: varchar("item_id").notNull(),
    categoryId: varchar("category_id"),
    fulfillmentId: varchar("fulfillment_id"),
    descriptorCode: varchar("descriptor_code"),
    descriptorName: varchar("descriptor_name"),
    descriptorShortDesc: varchar("descriptor_short_desc"),
    descriptorLongDesc: varchar("descriptor_long_desc"),
    quantityCount: integer("quantity_count"),
    timeLabel: varchar("time_label"),
    timeDuration: varchar("time_duration"),
    timeTimestamp: timestampWithTimezone("time_timestamp"),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("init_order_items_order_item_idx").on(
      table.initOrderId,
      table.itemId,
    ),
    index("init_order_items_init_order_id_idx").on(table.initOrderId),
  ],
);

// start/end side instruction images are native arrays (an ordered list with
// no independent identity of its own); fulfillment-level tags live in the
// shared `tags` table, keyed by `init_order_fulfillment_id`.
export const initOrderFulfillments = pgTable(
  "init_order_fulfillments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    initOrderId: uuid("init_order_id")
      .notNull()
      .references(() => initOrders.id, { onDelete: "cascade" }),
    fulfillmentId: varchar("fulfillment_id").notNull(),
    type: varchar("type"),
    awbNo: varchar("awb_no"),
    tracking: boolean("tracking"),
    stateCode: varchar("state_code"),
    stateShortDesc: varchar("state_short_desc"),
    // agent is a single object on the fulfillment itself per the contract
    // (sibling of start/end, not nested under either side) — only ever
    // populated once an LSP assigns a rider, which happens at /on_confirm.
    agentName: varchar("agent_name"),
    agentPhone: varchar("agent_phone"),
    // vehicle is likewise a single object on the fulfillment itself, not
    // nested under either side.
    vehicleRegistration: varchar("vehicle_registration"),

    startGps: varchar("start_gps"),
    startAddressName: varchar("start_address_name"),
    startAddressBuilding: varchar("start_address_building"),
    startAddressLocality: varchar("start_address_locality"),
    startAddressStreet: varchar("start_address_street"),
    startAddressCity: varchar("start_address_city"),
    startAddressState: varchar("start_address_state"),
    startAddressCountry: varchar("start_address_country"),
    startAddressAreaCode: varchar("start_address_area_code"),
    startAuthorizationType: varchar("start_authorization_type"),
    startContactPhone: varchar("start_contact_phone"),
    startContactEmail: varchar("start_contact_email"),
    startPersonName: varchar("start_person_name"),
    startTimeDuration: varchar("start_time_duration"),
    startTimeTimestamp: timestampWithTimezone("start_time_timestamp"),
    startTimeRangeStart: timestampWithTimezone("start_time_range_start"),
    startTimeRangeEnd: timestampWithTimezone("start_time_range_end"),
    startInstructionCode: varchar("start_instruction_code"),
    startInstructionShortDesc: varchar("start_instruction_short_desc"),
    startInstructionLongDesc: varchar("start_instruction_long_desc"),
    startInstructionAdditionalDescContentType: varchar(
      "start_instruction_additional_desc_content_type",
    ),
    startInstructionAdditionalDescUrl: varchar(
      "start_instruction_additional_desc_url",
    ),
    startInstructionImages: varchar("start_instruction_images").array(),

    endGps: varchar("end_gps"),
    endAddressName: varchar("end_address_name"),
    endAddressBuilding: varchar("end_address_building"),
    endAddressLocality: varchar("end_address_locality"),
    endAddressStreet: varchar("end_address_street"),
    endAddressCity: varchar("end_address_city"),
    endAddressState: varchar("end_address_state"),
    endAddressCountry: varchar("end_address_country"),
    endAddressAreaCode: varchar("end_address_area_code"),
    endAuthorizationType: varchar("end_authorization_type"),
    endContactPhone: varchar("end_contact_phone"),
    endContactEmail: varchar("end_contact_email"),
    endPersonName: varchar("end_person_name"),
    endTimeDuration: varchar("end_time_duration"),
    endTimeTimestamp: timestampWithTimezone("end_time_timestamp"),
    endTimeRangeStart: timestampWithTimezone("end_time_range_start"),
    endTimeRangeEnd: timestampWithTimezone("end_time_range_end"),
    endInstructionCode: varchar("end_instruction_code"),
    endInstructionShortDesc: varchar("end_instruction_short_desc"),
    endInstructionLongDesc: varchar("end_instruction_long_desc"),
    endInstructionAdditionalDescContentType: varchar(
      "end_instruction_additional_desc_content_type",
    ),
    endInstructionAdditionalDescUrl: varchar(
      "end_instruction_additional_desc_url",
    ),
    endInstructionImages: varchar("end_instruction_images").array(),

    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("init_order_fulfillments_order_fulfillment_idx").on(
      table.initOrderId,
      table.fulfillmentId,
    ),
    index("init_order_fulfillments_init_order_id_idx").on(table.initOrderId),
  ],
);

export const initOrderQuoteBreakups = pgTable(
  "init_order_quote_breakups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    initOrderId: uuid("init_order_id")
      .notNull()
      .references(() => initOrders.id, { onDelete: "cascade" }),
    itemId: varchar("item_id").notNull(),
    titleType: varchar("title_type").notNull(),
    priceAmount: decimal("price_amount", { precision: 18, scale: 2 }),
    priceCurrency: varchar("price_currency"),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("init_order_quote_breakups_init_order_id_idx").on(
      table.initOrderId,
    ),
  ],
);

export const initOrderSettlements = pgTable(
  "init_order_settlements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    initOrderId: uuid("init_order_id")
      .notNull()
      .references(() => initOrders.id, { onDelete: "cascade" }),
    settlementCounterparty: varchar("settlement_counterparty").notNull(),
    settlementType: varchar("settlement_type").notNull(),
    beneficiaryName: varchar("beneficiary_name"),
    upiAddress: varchar("upi_address"),
    settlementBankAccountNo: varchar("settlement_bank_account_no"),
    settlementIfscCode: varchar("settlement_ifsc_code"),
    settlementStatus: varchar("settlement_status"),
    settlementReference: varchar("settlement_reference"),
    settlementTimestamp: timestampWithTimezone("settlement_timestamp"),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("init_order_settlements_init_order_id_idx").on(table.initOrderId),
  ],
);

export const initOrderCancellationTerms = pgTable(
  "init_order_cancellation_terms",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    initOrderId: uuid("init_order_id")
      .notNull()
      .references(() => initOrders.id, { onDelete: "cascade" }),
    fulfillmentStateCode: varchar("fulfillment_state_code"),
    fulfillmentStateShortDesc: varchar("fulfillment_state_short_desc"),
    cancellationFeePercentage: decimal("cancellation_fee_percentage", {
      precision: 5,
      scale: 2,
    }),
    cancellationFeeAmount: decimal("cancellation_fee_amount", {
      precision: 18,
      scale: 2,
    }),
    cancellationFeeCurrency: varchar("cancellation_fee_currency"),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("init_order_cancellation_terms_init_order_id_idx").on(
      table.initOrderId,
    ),
  ],
);

// "@ondc/org/linked_order" item lines. The linked order's own scalar fields
// (weight, dimensions, provider descriptor) live directly on `initOrders`.
export const initOrderLinkedOrderItems = pgTable(
  "init_order_linked_order_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    initOrderId: uuid("init_order_id")
      .notNull()
      .references(() => initOrders.id, { onDelete: "cascade" }),
    descriptorName: varchar("descriptor_name"),
    quantityCount: integer("quantity_count"),
    quantityMeasureUnit: varchar("quantity_measure_unit"),
    quantityMeasureValue: decimal("quantity_measure_value", {
      precision: 18,
      scale: 6,
    }),
    priceAmount: decimal("price_amount", { precision: 18, scale: 2 }),
    priceCurrency: varchar("price_currency"),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("init_order_linked_order_items_init_order_id_idx").on(
      table.initOrderId,
    ),
  ],
);
