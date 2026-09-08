import {
  decimal,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { onSearchCallbacks } from "./on-search-callbacks.schema.js";

const timestampWithTimezone = (name: string) =>
  timestamp(name, { withTimezone: true });

// One row per provider per /on_search callback (not upserted by search —
// each callback keeps its own provider snapshot so multiple BPP callbacks
// for the same search, and repeated corrections from the same BPP, are all
// preserved rather than overwriting each other).
export const searchProviders = pgTable(
  "search_providers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    callbackId: uuid("callback_id")
      .notNull()
      .references(() => onSearchCallbacks.id, { onDelete: "cascade" }),
    providerId: varchar("provider_id").notNull(),
    name: varchar("name"),
    shortDescription: varchar("short_description"),
    longDescription: varchar("long_description"),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("search_providers_callback_provider_idx").on(
      table.callbackId,
      table.providerId,
    ),
    index("search_providers_callback_id_idx").on(table.callbackId),
  ],
);

export const searchProviderCategories = pgTable(
  "search_provider_categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    providerRowId: uuid("provider_row_id")
      .notNull()
      .references(() => searchProviders.id, { onDelete: "cascade" }),
    categoryId: varchar("category_id"),
    timeLabel: varchar("time_label"),
    duration: varchar("duration"),
    timestamp: timestampWithTimezone("timestamp"),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("search_provider_categories_provider_row_id_idx").on(
      table.providerRowId,
    ),
  ],
);

// Provider locations for search live in the shared `provider_locations`
// table (see shared.schema.ts), keyed by `search_provider_row_id`.

export const searchProviderFulfillments = pgTable(
  "search_provider_fulfillments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    providerRowId: uuid("provider_row_id")
      .notNull()
      .references(() => searchProviders.id, { onDelete: "cascade" }),
    fulfillmentId: varchar("fulfillment_id"),
    type: varchar("type"),
    pickupDuration: varchar("pickup_duration"),
    motorableDistance: decimal("motorable_distance", {
      precision: 18,
      scale: 6,
    }),
    motorableDistanceUnit: varchar("motorable_distance_unit"),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("search_provider_fulfillments_provider_row_id_idx").on(
      table.providerRowId,
    ),
  ],
);

// Fulfillment-level tags from /on_search (e.g. linked_provider,
// fulfill_request/response) live in the shared `tags`/`tag_values` tables
// (see shared.schema.ts), keyed by `search_provider_fulfillment_id`. /init
// selects a subset of these codes to forward on the order fulfillment it
// sends to the BPP.

export const searchProviderItems = pgTable(
  "search_provider_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    providerRowId: uuid("provider_row_id")
      .notNull()
      .references(() => searchProviders.id, { onDelete: "cascade" }),
    fulfillmentRowId: uuid("fulfillment_row_id").references(
      () => searchProviderFulfillments.id,
      { onDelete: "set null" },
    ),
    catalogItemId: varchar("catalog_item_id").notNull(),
    parentItemId: varchar("parent_item_id"),
    categoryId: varchar("category_id"),
    fulfillmentId: varchar("fulfillment_id"),
    descriptorCode: varchar("descriptor_code"),
    name: varchar("name"),
    shortDescription: varchar("short_description"),
    longDescription: varchar("long_description"),
    tatLabel: varchar("tat_label"),
    tatDuration: varchar("tat_duration"),
    tatTimestamp: timestampWithTimezone("tat_timestamp"),
    priceAmount: decimal("price_amount", { precision: 18, scale: 2 }),
    priceCurrency: varchar("price_currency"),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("search_provider_items_provider_catalog_item_idx").on(
      table.providerRowId,
      table.catalogItemId,
    ),
    index("search_provider_items_provider_row_id_idx").on(
      table.providerRowId,
    ),
    index("search_provider_items_fulfillment_row_id_idx").on(
      table.fulfillmentRowId,
    ),
  ],
);

export const searchProviderStaticTerms = pgTable(
  "search_provider_static_terms",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    providerRowId: uuid("provider_row_id")
      .notNull()
      .references(() => searchProviders.id, { onDelete: "cascade" }),
    staticTermsUrl: varchar("static_terms_url"),
    staticTermsNewUrl: varchar("static_terms_new_url"),
    effectiveDate: timestampWithTimezone("effective_date"),
    version: varchar("version"),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("search_provider_static_terms_provider_row_id_idx").on(
      table.providerRowId,
    ),
  ],
);
