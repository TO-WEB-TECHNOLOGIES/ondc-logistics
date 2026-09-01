import {
  index,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
export const onSearchCallbacks = pgTable(
  "on_search_callbacks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    transactionId: varchar("transaction_id").notNull(),
    messageId: varchar("message_id").notNull(),
    bppId: varchar("bpp_id").notNull(),
    bppUri: varchar("bpp_uri"),
    payload: jsonb("payload").notNull(),
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
  ],
);
