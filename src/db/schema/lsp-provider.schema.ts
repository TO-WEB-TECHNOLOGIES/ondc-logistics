import {
  AnyPgColumn,
  decimal,
  index,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { logisticsSearches } from "./logistics-search.schema.js";

const timestampWithTimezone = (name: string) =>
  timestamp(name, { withTimezone: true });

export const lspProviders = pgTable(
  "lsp_providers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    searchId: uuid("search_id")
      .notNull()
      .references(() => logisticsSearches.id, { onDelete: "cascade" }),
    providerId: varchar("provider_id").notNull(),
    name: varchar("name"),
    shortDescription: varchar("short_description"),
    longDescription: varchar("long_description"),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
    updatedAt: timestampWithTimezone("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("lsp_providers_search_id_idx").on(table.searchId),
    index("lsp_providers_provider_id_idx").on(table.providerId),
  ],
);

export const lspProviderCategories = pgTable(
  "lsp_provider_categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    providerDbId: uuid("provider_db_id")
      .notNull()
      .references(() => lspProviders.id, { onDelete: "cascade" }),
    categoryId: varchar("category_id"),
    timeLabel: varchar("time_label"),
    duration: varchar("duration"),
    timestamp: timestampWithTimezone("timestamp"),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("lsp_provider_categories_provider_db_id_idx").on(table.providerDbId),
  ],
);

export const lspProviderFulfillments = pgTable(
  "lsp_provider_fulfillments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    providerDbId: uuid("provider_db_id")
      .notNull()
      .references(() => lspProviders.id, { onDelete: "cascade" }),
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
    index("lsp_provider_fulfillments_provider_db_id_idx").on(
      table.providerDbId,
    ),
  ],
);

export const lspProviderLocations = pgTable(
  "lsp_provider_locations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    providerDbId: uuid("provider_db_id")
      .notNull()
      .references(() => lspProviders.id, { onDelete: "cascade" }),
    locationId: varchar("location_id"),
    gps: varchar("gps"),
    street: varchar("street"),
    city: varchar("city"),
    state: varchar("state"),
    areaCode: varchar("area_code"),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("lsp_provider_locations_provider_db_id_idx").on(table.providerDbId),
  ],
);

export const lspCatalogItems = pgTable(
  "lsp_catalog_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    providerDbId: uuid("provider_db_id")
      .notNull()
      .references(() => lspProviders.id, { onDelete: "cascade" }),
    parentItemId: uuid("parent_item_id").references(
      (): AnyPgColumn => lspCatalogItems.id,
      {
        onDelete: "set null",
      },
    ),
    categoryId: varchar("category_id"),
    fulfillmentDbId: uuid("fulfillment_db_id").references(
      () => lspProviderFulfillments.id,
      {
        onDelete: "set null",
      },
    ),
    catalogItemId: varchar("catalog_item_id"),
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
    updatedAt: timestampWithTimezone("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("lsp_catalog_items_provider_db_id_idx").on(table.providerDbId),
    index("lsp_catalog_items_parent_item_id_idx").on(table.parentItemId),
    index("lsp_catalog_items_fulfillment_db_id_idx").on(table.fulfillmentDbId),
  ],
);

export const lspStaticTerms = pgTable(
  "lsp_static_terms",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    providerDbId: uuid("provider_db_id")
      .notNull()
      .references(() => lspProviders.id, { onDelete: "cascade" }),
    staticTermsUrl: varchar("static_terms_url"),
    staticTermsNewUrl: varchar("static_terms_new_url"),
    effectiveDate: timestampWithTimezone("effective_date"),
    version: varchar("version"),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
    updatedAt: timestampWithTimezone("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("lsp_static_terms_provider_db_id_idx").on(table.providerDbId),
  ],
);
