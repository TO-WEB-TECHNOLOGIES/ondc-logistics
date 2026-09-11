import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { initOrderFulfillments, initOrders } from "./init-order.schema.js";
import { logisticsOrder } from "./logistics-order.schema.js";
import {
  searchProviderFulfillments,
  searchProviders,
} from "./search-provider.schema.js";

const timestampWithTimezone = (name: string) =>
  timestamp(name, { withTimezone: true });

// Shared by search_providers (/on_search) and init_orders (/init, /on_init)
// provider.locations[]. Exactly one owner FK is set per row — enforced by
// the check constraint below rather than a polymorphic owner_id, so each
// owner still gets a real FK with ON DELETE CASCADE.
export const providerLocations = pgTable(
  "provider_locations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    searchProviderRowId: uuid("search_provider_row_id").references(
      () => searchProviders.id,
      { onDelete: "cascade" },
    ),
    initOrderRowId: uuid("init_order_row_id").references(() => initOrders.id, {
      onDelete: "cascade",
    }),
    locationId: varchar("location_id").notNull(),
    position: integer("position").notNull().default(0),
    gps: varchar("gps"),
    addressName: varchar("address_name"),
    addressBuilding: varchar("address_building"),
    addressLocality: varchar("address_locality"),
    street: varchar("street"),
    city: varchar("city"),
    state: varchar("state"),
    country: varchar("country"),
    areaCode: varchar("area_code"),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("provider_locations_search_provider_row_id_idx").on(
      table.searchProviderRowId,
    ),
    index("provider_locations_init_order_row_id_idx").on(table.initOrderRowId),
    check(
      "provider_locations_exactly_one_owner",
      sql`num_nonnulls(${table.searchProviderRowId}, ${table.initOrderRowId}) = 1`,
    ),
  ],
);

// Shared by search_provider_fulfillments (/on_search), init_orders
// (order-level) / init_order_fulfillments (fulfillment-level) tags, and
// logistics_order (confirmed-order order/fulfillment tags — e.g. the
// "state"/ready_to_ship tag — logistics_order has a single fulfillment per
// row, so one owner column covers both order- and fulfillment-level tags
// for a confirmed order).
export const tags = pgTable(
  "tags",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    initOrderId: uuid("init_order_id").references(() => initOrders.id, {
      onDelete: "cascade",
    }),
    initOrderFulfillmentId: uuid("init_order_fulfillment_id").references(
      () => initOrderFulfillments.id,
      { onDelete: "cascade" },
    ),
    searchProviderFulfillmentId: uuid(
      "search_provider_fulfillment_id",
    ).references(() => searchProviderFulfillments.id, {
      onDelete: "cascade",
    }),
    logisticsOrderId: varchar("logistics_order_id").references(
      () => logisticsOrder.orderId,
      { onDelete: "cascade" },
    ),
    code: varchar("code").notNull(),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("tags_init_order_id_idx").on(table.initOrderId),
    index("tags_init_order_fulfillment_id_idx").on(table.initOrderFulfillmentId),
    index("tags_search_provider_fulfillment_id_idx").on(
      table.searchProviderFulfillmentId,
    ),
    index("tags_logistics_order_id_idx").on(table.logisticsOrderId),
    check(
      "tags_exactly_one_owner",
      sql`num_nonnulls(${table.initOrderId}, ${table.initOrderFulfillmentId}, ${table.searchProviderFulfillmentId}, ${table.logisticsOrderId}) = 1`,
    ),
  ],
);

export const tagValues = pgTable(
  "tag_values",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    code: varchar("code").notNull(),
    value: varchar("value"),
  },
  (table) => [index("tag_values_tag_id_idx").on(table.tagId)],
);
