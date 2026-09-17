import {
  decimal,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

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
    // Populated from message.issue.resolution once the BPP proposes/executes
    // one (real IGM 2.0 payload — see issue_actions comment on issueActions
    // below). resolution_provider (GRO/org contact details) is observed but
    // not persisted yet — flagged as a follow-up, not central to acceptance.
    resolutionActionTriggered: varchar("resolution_action_triggered"),
    resolutionShortDesc: varchar("resolution_short_desc"),
    resolutionLongDesc: varchar("resolution_long_desc"),
    resolutionRefundAmount: decimal("resolution_refund_amount", {
      precision: 18,
      scale: 2,
    }),
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

// Append-only action history — the source of truth for last_action_id and
// for rebuilding the full actions[] array on every subsequent outbound
// /issue call. One row per action, ever; never updated.
//
// Covers TWO observed wire shapes (see schemas/issue.schema.ts's
// OndcIssueObject comment):
//   1. The flat sample shape (src/json/on_issue.json): actions[] with a
//      per-action id, a shared actor referenced via action_by/actors[].
//   2. The real IGM 2.0 shape confirmed from live workbench.ondc.tech
//      traffic: issue_actions.{complainant_actions,respondent_actions}[],
//      no per-action id (synthesized as "<side>-<index>" — see
//      issue.repository.ts), and the acting party's contact info embedded
//      inline per action (`updated_by`) instead of referenced by id — hence
//      actorOrgName/actorPersonName/actorPhone/actorEmail below, alongside
//      the existing actorDetailsName (shape 1) and actionBy (shape 1, a
//      plain actor id string).
export const issueActions = pgTable(
  "issue_actions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    actionId: varchar("action_id").notNull(), // A1, A2, A3_1, ... OR complainant-0/respondent-0, ...
    // "complainant" | "respondent" | null (shape 1 has no side — action_by identifies the actor directly).
    side: varchar("side"),
    cascadedLevel: integer("cascaded_level"),
    descriptorCode: varchar("descriptor_code").notNull(), // OPEN | PROCESSING | INFO_REQUESTED | RESOLUTION_PROPOSED | ...
    descriptorName: varchar("descriptor_name"),
    shortDesc: varchar("short_desc"),
    updatedAt: timestampWithTimezone("updated_at"), // the action's own updated_at from the payload
    actionBy: varchar("action_by"),
    actorDetailsName: varchar("actor_details_name"),
    actorOrgName: varchar("actor_org_name"),
    actorPersonName: varchar("actor_person_name"),
    actorPhone: varchar("actor_phone"),
    actorEmail: varchar("actor_email"),
    resolutionId: varchar("resolution_id"),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("issue_actions_issue_action_idx").on(table.issueId, table.actionId),
    index("issue_actions_issue_id_idx").on(table.issueId),
  ],
);
