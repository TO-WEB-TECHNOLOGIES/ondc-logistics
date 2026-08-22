import { index, jsonb, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
export const ondcTransactions = pgTable("ondc_transactions", {
  id: uuid("id").defaultRandom().primaryKey(), transactionId: varchar("transaction_id").notNull(),
  messageId: varchar("message_id").notNull(), action: varchar("action").notNull(),
  status: varchar("status").notNull().default("pending"), errorCode: varchar("error_code"),
  errorMessage: varchar("error_message"), domain: varchar("domain"), country: varchar("country"),
  city: varchar("city"), coreVersion: varchar("core_version"), bapId: varchar("bap_id"),
  bapUri: varchar("bap_uri"), bppId: varchar("bpp_id"), bppUri: varchar("bpp_uri"),
  timestamp: timestamp("timestamp", { withTimezone: true }), ttl: varchar("ttl"),
  requestPayload: jsonb("request_payload"), responsePayload: jsonb("response_payload"),
  callbackMessageId: varchar("callback_message_id"),
  callbackTimestamp: timestamp("callback_timestamp", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("ondc_transactions_transaction_id_idx").on(table.transactionId),
  index("ondc_transactions_message_id_idx").on(table.messageId),
  index("ondc_transactions_action_idx").on(table.action),
]);

