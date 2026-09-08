import {
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { logisticsSearches } from "./logistics-search.schema.js";

export const onSearchCallbacks = pgTable(
  "on_search_callbacks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    searchId: uuid("search_id")
      .notNull()
      .references(() => logisticsSearches.id, { onDelete: "cascade" }),
    transactionId: varchar("transaction_id").notNull(),
    messageId: varchar("message_id").notNull(),
    bppId: varchar("bpp_id").notNull(),
    bppUri: varchar("bpp_uri"),
    status: varchar("status").notNull().default("staged"),
    errorMessage: varchar("error_message"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("on_search_callbacks_identity_idx").on(
      table.transactionId,
      table.messageId,
      table.bppId,
    ),
    index("on_search_callbacks_transaction_id_idx").on(table.transactionId),
    index("on_search_callbacks_search_id_idx").on(table.searchId),
  ],
);
