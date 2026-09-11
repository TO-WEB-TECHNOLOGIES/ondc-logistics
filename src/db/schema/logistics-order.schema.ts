import { index, jsonb, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

const timestampWithTimezone = (name: string) =>
  timestamp(name, { withTimezone: true });

// Confirmed-order storage (from /confirm onward). Deliberately denormalized
// vs. the rest of this schema: every nested/array ONDC structure (items,
// fulfillments, quote, linked_order, billing, payment, cancellation_terms,
// tags) is stored as JSONB rather than broken into child tables — see the
// implementation plan for the rationale. /init and /on_init continue to be
// persisted separately via init_orders (unrelated to this table).
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

    items: jsonb("items"),
    fulfillments: jsonb("fulfillments"),
    quote: jsonb("quote"),
    linkedOrder: jsonb("linked_order"), // @ondc/org/linked_order
    billing: jsonb("billing"),
    payment: jsonb("payment"), // incl. @ondc/org/settlement_details
    cancellationTerms: jsonb("cancellation_terms"),
    tags: jsonb("tags"),

    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
    updatedAt: timestampWithTimezone("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("logistics_order_transaction_id_idx").on(table.transactionId),
  ],
);
