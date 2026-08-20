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
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
    updatedAt: timestampWithTimezone("updated_at").defaultNow().notNull(),
  },
  (table) => [index("logistics_searches_transaction_db_id_idx").on(table.transactionDbId)],
);

export const logisticsSearchLocations = pgTable(
  "logistics_search_locations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    searchId: uuid("search_id")
      .notNull()
      .references(() => logisticsSearches.id, { onDelete: "cascade" }),
    locationType: varchar("location_type"),
    gps: varchar("gps"),
    areaCode: varchar("area_code"),
    name: varchar("name"),
    building: varchar("building"),
    locality: varchar("locality"),
    street: varchar("street"),
    city: varchar("city"),
    state: varchar("state"),
    country: varchar("country"),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
  },
  (table) => [index("logistics_search_locations_search_id_idx").on(table.searchId)],
);

export const logisticsSearchProviderSchedules = pgTable(
  "logistics_search_provider_schedules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    searchId: uuid("search_id")
      .notNull()
      .references(() => logisticsSearches.id, { onDelete: "cascade" }),
    days: varchar("days"),
    duration: varchar("duration"),
    rangeStart: time("range_start"),
    rangeEnd: time("range_end"),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
  },
  (table) => [index("logistics_search_provider_schedules_search_id_idx").on(table.searchId)],
);

export const logisticsSearchHolidays = pgTable(
  "logistics_search_holidays",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scheduleId: uuid("schedule_id")
      .notNull()
      .references(() => logisticsSearchProviderSchedules.id, { onDelete: "cascade" }),
    holidayDate: date("holiday_date"),
  },
  (table) => [index("logistics_search_holidays_schedule_id_idx").on(table.scheduleId)],
);

export const logisticsSearchPayloads = pgTable(
  "logistics_search_payloads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    searchId: uuid("search_id")
      .notNull()
      .references(() => logisticsSearches.id, { onDelete: "cascade" }),
    weightValue: decimal("weight_value", { precision: 18, scale: 6 }),
    weightUnit: varchar("weight_unit"),
    lengthValue: decimal("length_value", { precision: 18, scale: 6 }),
    lengthUnit: varchar("length_unit"),
    breadthValue: decimal("breadth_value", { precision: 18, scale: 6 }),
    breadthUnit: varchar("breadth_unit"),
    heightValue: decimal("height_value", { precision: 18, scale: 6 }),
    heightUnit: varchar("height_unit"),
    category: varchar("category"),
    valueAmount: decimal("value_amount", { precision: 18, scale: 2 }),
    valueCurrency: varchar("value_currency"),
    dangerousGoods: boolean("dangerous_goods"),
  },
  (table) => [index("logistics_search_payloads_search_id_idx").on(table.searchId)],
);

export const logisticsSearchPayments = pgTable(
  "logistics_search_payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    searchId: uuid("search_id")
      .notNull()
      .references(() => logisticsSearches.id, { onDelete: "cascade" }),
    type: varchar("type"),
    collectionAmount: decimal("collection_amount", { precision: 18, scale: 2 }),
    currency: varchar("currency"),
  },
  (table) => [index("logistics_search_payments_search_id_idx").on(table.searchId)],
);
