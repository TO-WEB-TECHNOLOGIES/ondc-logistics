import {
  boolean,
  date,
  decimal,
  index,
  pgTable,
  time,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { ondcTransactions } from "./ondc-transactions.schema.js";

const timestampWithTimezone = (name: string) =>
  timestamp(name, { withTimezone: true });

// One row per /search request. Locations (start/end), the provider
// schedule, the shipment payload, and payment terms were previously split
// into five child tables; each is either exactly one row per search or a
// short list, so they're flattened here as columns (holidays as a native
// Postgres array) instead.
export const logisticsSearches = pgTable(
  "logistics_searches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    transactionDbId: uuid("transaction_db_id")
      .notNull()
      .references(() => ondcTransactions.id, { onDelete: "cascade" }),
    categoryId: varchar("category_id"),
    fulfillmentType: varchar("fulfillment_type"),
    authorizationStartType: varchar("authorization_start_type"),
    authorizationEndType: varchar("authorization_end_type"),

    startGps: varchar("start_gps"),
    startAddressName: varchar("start_address_name"),
    startAddressBuilding: varchar("start_address_building"),
    startAddressLocality: varchar("start_address_locality"),
    startAddressStreet: varchar("start_address_street"),
    startAddressCity: varchar("start_address_city"),
    startAddressState: varchar("start_address_state"),
    startAddressCountry: varchar("start_address_country"),
    startAreaCode: varchar("start_area_code"),

    endGps: varchar("end_gps"),
    endAddressName: varchar("end_address_name"),
    endAddressBuilding: varchar("end_address_building"),
    endAddressLocality: varchar("end_address_locality"),
    endAddressStreet: varchar("end_address_street"),
    endAddressCity: varchar("end_address_city"),
    endAddressState: varchar("end_address_state"),
    endAddressCountry: varchar("end_address_country"),
    endAreaCode: varchar("end_area_code"),

    scheduleDays: varchar("schedule_days"),
    scheduleDuration: varchar("schedule_duration"),
    scheduleRangeStart: time("schedule_range_start"),
    scheduleRangeEnd: time("schedule_range_end"),
    scheduleHolidays: date("schedule_holidays").array(),

    payloadWeightValue: decimal("payload_weight_value", {
      precision: 18,
      scale: 6,
    }),
    payloadWeightUnit: varchar("payload_weight_unit"),
    payloadLengthValue: decimal("payload_length_value", {
      precision: 18,
      scale: 6,
    }),
    payloadLengthUnit: varchar("payload_length_unit"),
    payloadBreadthValue: decimal("payload_breadth_value", {
      precision: 18,
      scale: 6,
    }),
    payloadBreadthUnit: varchar("payload_breadth_unit"),
    payloadHeightValue: decimal("payload_height_value", {
      precision: 18,
      scale: 6,
    }),
    payloadHeightUnit: varchar("payload_height_unit"),
    payloadCategory: varchar("payload_category"),
    payloadValueAmount: decimal("payload_value_amount", {
      precision: 18,
      scale: 2,
    }),
    payloadValueCurrency: varchar("payload_value_currency"),
    payloadDangerousGoods: boolean("payload_dangerous_goods"),

    paymentType: varchar("payment_type"),
    paymentCollectionAmount: decimal("payment_collection_amount", {
      precision: 18,
      scale: 2,
    }),
    paymentCurrency: varchar("payment_currency"),

    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
    updatedAt: timestampWithTimezone("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("logistics_searches_transaction_db_id_idx").on(table.transactionDbId),
  ],
);
