import { index, pgTable, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

const timestampWithTimezone = (name: string) =>
  timestamp(name, { withTimezone: true });

// ONDC IGM (Issue & Grievance) storage. One row per issue ticket raised by
// or against this BAP via /issue|/on_issue|/issue_status|/on_issue_status.
// Flat scalar columns on the parent, one-to-many children for refs/actors/
// actions — same split as init_orders' children in init-order.schema.ts.
// No pgEnum (not used anywhere in this repo) and no JSONB (repo convention:
// normalized child tables only).
export const issues = pgTable(
  "issues",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // generateIssueId() — see src/utils/order-id.ts. This is the BAP-assigned
    // ONDC message.issue.id, echoed back by the BPP on every callback.
    issueId: varchar("issue_id").notNull(),
    // Plain indexed reference, no FK — same convention as
    // logistics_order.transactionId / ondc_transactions.parent_transaction_id.
    transactionId: varchar("transaction_id").notNull(),
    orderId: varchar("order_id").notNull(),
    bppId: varchar("bpp_id"),
    bppUri: varchar("bpp_uri"),
    categoryCode: varchar("category_code").notNull(), // BAP IssueCategoryCode (constants/issueCategories.ts)
    descriptorCode: varchar("descriptor_code").notNull(), // ONDC descriptor code (e.g. ITM004)
    status: varchar("status").notNull().default("OPEN"), // OPEN | PROCESSING | RESOLVED | CLOSED
    level: varchar("level").notNull().default("ISSUE"), // ISSUE | GRIEVANCE | DISPUTE
    shortDesc: varchar("short_desc"),
    longDesc: varchar("long_desc"),
    additionalDescUrl: varchar("additional_desc_url"),
    additionalDescContentType: varchar("additional_desc_content_type"),
    // Simple ordered list with no independent identity — native array, same
    // treatment as startInstructionImages elsewhere in this schema dir.
    respondentIds: varchar("respondent_ids").array(),
    sourceId: varchar("source_id"),
    complainantId: varchar("complainant_id"),
    expectedResponseDuration: varchar("expected_response_duration"), // ISO8601 duration, e.g. PT2H
    expectedResolutionDuration: varchar("expected_resolution_duration"),
    lastActionId: varchar("last_action_id"),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
    updatedAt: timestampWithTimezone("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("issues_issue_id_idx").on(table.issueId),
    index("issues_order_id_idx").on(table.orderId),
    index("issues_transaction_id_idx").on(table.transactionId),
  ],
);

export const issueRefs = pgTable(
  "issue_refs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    refId: varchar("ref_id").notNull(),
    refType: varchar("ref_type").notNull(), // ORDER | PROVIDER | FULFILLMENT | ITEM | RESOLUTIONS
    // Flattens the one tag shape the IGM samples actually carry on ITEM refs:
    // tags: [{ descriptor: { code: "message.order.items" }, list: [{ descriptor:
    // { code: "quantity.selected.count" }, value }] }].
    quantityCount: varchar("quantity_count"),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
  },
  (table) => [index("issue_refs_issue_id_idx").on(table.issueId)],
);

export const issueActors = pgTable(
  "issue_actors",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    actorId: varchar("actor_id").notNull(),
    actorType: varchar("actor_type").notNull(), // CONSUMER | INTERFACING_NP | COUNTERPARTY_NP | INTERFACING_NP_GRO
    orgName: varchar("org_name"),
    personName: varchar("person_name"),
    contactPhone: varchar("contact_phone"),
    contactEmail: varchar("contact_email"),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("issue_actors_issue_actor_idx").on(table.issueId, table.actorId),
    index("issue_actors_issue_id_idx").on(table.issueId),
  ],
);

// Append-only action history (issue.actions[]) — the source of truth for
// last_action_id and for rebuilding the full actions[] array on every
// subsequent outbound /issue call. One row per action, ever; never updated.
export const issueActions = pgTable(
  "issue_actions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    actionId: varchar("action_id").notNull(), // A1, A2, A3_1, ...
    descriptorCode: varchar("descriptor_code").notNull(), // OPEN | PROCESSING | INFO_REQUESTED | RESOLUTION_PROPOSED | ...
    descriptorName: varchar("descriptor_name"),
    shortDesc: varchar("short_desc"),
    updatedAt: timestampWithTimezone("updated_at"), // the action's own updated_at from the payload
    actionBy: varchar("action_by"),
    actorDetailsName: varchar("actor_details_name"),
    resolutionId: varchar("resolution_id"),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("issue_actions_issue_action_idx").on(table.issueId, table.actionId),
    index("issue_actions_issue_id_idx").on(table.issueId),
  ],
);
