import { and, desc, eq } from "drizzle-orm";
import { db1 } from "../db/index.js";
import {
  issueActions,
  issueActors,
  issueRefs,
  issues,
  ondcTransactions,
} from "../db/schema/index.js";
import { clientStreamManager } from "../utils/streams/client-stream.js";
import type { CallbackStream } from "../utils/streams/callback-stream.js";
import { loadLogisticsOrder, type LogisticsOrderRow, type Tx } from "./logistics-order-shared.js";
import type {
  OndcIssueObject,
  OndcIssueResolutionProvider,
  OndcIssueRequest,
  OndcIssueStatusRequest,
  OndcOnIssueResponse,
  OndcOnIssueStatusResponse,
} from "../schemas/issue.schema.js";

export type IssueCallbackResult =
  | "processed"
  | "duplicate"
  | "not_found"
  | "invalid_bpp";

/** One row of issue.actions[] — used both to persist a new action and to read history back. */
export interface IssueActionRow {
  actionId: string;
  descriptorCode: string;
  descriptorName?: string;
  shortDesc?: string;
  updatedAt: string;
  actionBy: string;
  actorDetailsName?: string;
  resolutionId?: string;
  /** "complainant" for actions we send (IGM 1.0.0 complainant_actions), "respondent" for the LSP's. */
  side?: string;
  actorOrgName?: string;
  actorPersonName?: string;
  actorPhone?: string;
  actorEmail?: string;
}

export interface FullIssue {
  id: string; // internal uuid row id
  issueId: string;
  transactionId: string;
  orderId: string;
  bppId?: string;
  bppUri?: string;
  categoryCode: string;
  descriptorCode: string;
  status: string;
  level: string;
  shortDesc?: string;
  longDesc?: string;
  additionalDescUrl?: string;
  additionalDescContentType?: string;
  respondentIds?: string[];
  sourceId?: string;
  complainantId?: string;
  expectedResponseDuration?: string;
  expectedResolutionDuration?: string;
  lastActionId?: string;
  createdAt: string;
  refs: { refId: string; refType: string; quantityCount?: string }[];
  actors: {
    actorId: string;
    actorType: string;
    orgName?: string;
    personName?: string;
    contactPhone?: string;
    contactEmail?: string;
  }[];
  actions: IssueActionRow[];
}

/**
 * Frontend read model for GET /logistics/issues/:issueId — kept separate from
 * FullIssue (which feeds outbound /issue payload construction) so the read
 * side can expose resolution/actor columns without touching the wire path.
 */
export interface IssueDetails {
  issueId: string;
  orderId: string;
  transactionId: string;
  bppId?: string;
  categoryCode: string;
  /** IGM 1.0.0 sub_category, e.g. ITM04. */
  subCategory: string;
  /** Ours, the complainant's: OPEN | CLOSED. */
  status: string;
  /** ISSUE | GRIEVANCE | DISPUTE. */
  issueType: string;
  /** Latest respondent (LSP) action code, e.g. PROCESSING / RESOLVED. */
  respondentStatus?: string;
  rating?: string;
  shortDesc?: string;
  longDesc?: string;
  additionalDescUrl?: string;
  expectedResponseDuration?: string;
  expectedResolutionDuration?: string;
  resolution?: {
    actionTriggered?: string;
    shortDesc?: string;
    longDesc?: string;
    refundAmount?: string;
  };
  resolutionProvider?: {
    type?: string;
    organization?: { orgName?: string; personName?: string; phone?: string; email?: string };
    support?: { chatLink?: string; phone?: string; email?: string };
    gros: { groType?: string; personName?: string; phone?: string; email?: string }[];
  };
  refs: { refId: string; refType: string; quantityCount?: string }[];
  actors: FullIssue["actors"];
  actions: {
    actionId: string;
    side?: string;
    cascadedLevel?: number;
    code: string;
    name?: string;
    shortDesc?: string;
    updatedAt: string;
    actionBy?: string;
    actorName?: string;
    actorOrgName?: string;
    actorPersonName?: string;
    actorPhone?: string;
    actorEmail?: string;
    resolutionId?: string;
  }[];
  createdAt: string;
  updatedAt: string;
}

/** One row of GET /logistics/orders/:orderId/issues. */
export interface IssueSummary {
  issueId: string;
  categoryCode: string;
  subCategory: string;
  status: string;
  issueType: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateIssueParams {
  payload: OndcIssueRequest;
  orderId: string;
  categoryCode: string;
  initialAction: IssueActionRow;
}

export interface AppendIssueActionParams {
  issueRowId: string;
  payload: OndcIssueRequest;
  orderId: string;
  action: IssueActionRow;
  nextStatus: string;
  nextIssueType: string;
  rating?: string;
}

export interface IssueRepository {
  loadOrder(orderId: string): Promise<LogisticsOrderRow | undefined>;
  findByIssueId(issueId: string): Promise<FullIssue | undefined>;
  getIssueDetails(issueId: string): Promise<IssueDetails | undefined>;
  listIssuesByOrder(orderId: string): Promise<IssueSummary[]>;
  createIssue(params: CreateIssueParams): Promise<{ created: boolean }>;
  appendIssueAction(params: AppendIssueActionParams): Promise<{ created: boolean }>;
  createIssueStatusCheck(
    payload: OndcIssueStatusRequest,
    orderId: string,
  ): Promise<{ created: boolean }>;
  updateStatus(
    transactionId: string,
    messageId: string,
    action: "issue" | "issue_status",
    status: string,
    error?: { code?: string; message?: string },
  ): Promise<void>;
  handleOnIssue(
    response: OndcOnIssueResponse,
    stream?: CallbackStream,
  ): Promise<IssueCallbackResult>;
  handleOnIssueStatus(
    response: OndcOnIssueStatusResponse,
    stream?: CallbackStream,
  ): Promise<IssueCallbackResult>;
}

// issue_actors ids used for the IGM 1.0.0 resolution_provider (see
// persistResolutionProvider). Excluded from IssueDetails.actors.
const RESOLUTION_PROVIDER_ACTOR = "resolution-provider";
const RESOLUTION_SUPPORT_ACTOR = "resolution-support";
const GRO_ACTOR_PREFIX = "gro-";
const isResolutionProviderActor = (actorId: string) =>
  actorId === RESOLUTION_PROVIDER_ACTOR ||
  actorId === RESOLUTION_SUPPORT_ACTOR ||
  actorId.startsWith(GRO_ACTOR_PREFIX);

/**
 * Replaces this issue's resolution_provider rows (provider org, support contact,
 * GROs) with the latest callback's — normalized issue_actors rows + the
 * chat_link column, per this schema's no-JSONB convention.
 */
const persistResolutionProvider = async (
  tx: Tx,
  issueRowId: string,
  rp: OndcIssueResolutionProvider | undefined,
) => {
  const info = rp?.respondent_info;
  if (!info) return;
  const existing = await tx
    .select({ id: issueActors.id, actorId: issueActors.actorId })
    .from(issueActors)
    .where(eq(issueActors.issueId, issueRowId));
  const stale = existing.filter((a) => isResolutionProviderActor(a.actorId));
  for (const a of stale) await tx.delete(issueActors).where(eq(issueActors.id, a.id));

  const support = info.resolution_support;
  const rows = [
    {
      actorId: RESOLUTION_PROVIDER_ACTOR,
      actorType: info.type ?? "RESOLUTION-PROVIDER",
      orgName: info.organization?.org?.name,
      personName: info.organization?.person?.name,
      contactPhone: info.organization?.contact?.phone,
      contactEmail: info.organization?.contact?.email,
    },
    ...(support?.contact
      ? [
          {
            actorId: RESOLUTION_SUPPORT_ACTOR,
            actorType: "RESOLUTION-SUPPORT",
            contactPhone: support.contact.phone,
            contactEmail: support.contact.email,
          },
        ]
      : []),
    ...(support?.gros ?? []).map((g, i) => ({
      actorId: `${GRO_ACTOR_PREFIX}${i}`,
      actorType: g.gro_type ?? "GRO",
      personName: g.person?.name,
      contactPhone: g.contact?.phone,
      contactEmail: g.contact?.email,
    })),
  ];
  await tx.insert(issueActors).values(rows.map((r) => ({ issueId: issueRowId, ...r })));
  await tx
    .update(issues)
    .set({ resolutionSupportChatLink: support?.chat_link ?? null })
    .where(eq(issues.id, issueRowId));
};

/** One action extracted from either observed callback shape — see issue_actions column comments in db/schema/issue.schema.ts. */
interface IncomingAction {
  actionId: string;
  descriptorCode: string;
  descriptorName?: string;
  shortDesc?: string;
  updatedAt: string;
  actionBy?: string;
  actorDetailsName?: string;
  side?: "complainant" | "respondent";
  cascadedLevel?: number;
  actorOrgName?: string;
  actorPersonName?: string;
  actorPhone?: string;
  actorEmail?: string;
}

/**
 * Merges the flat shape (issue.actions[], src/json/on_issue.json) and the
 * real IGM 2.0 shape confirmed from live workbench.ondc.tech traffic
 * (issue.issue_actions.{complainant_actions,respondent_actions}[], no
 * per-action id — synthesized as "<side>-<index>", actor info embedded
 * inline via `updated_by` instead of referenced by id).
 */
const collectIncomingActions = (issue: OndcIssueObject): IncomingAction[] => {
  const result: IncomingAction[] = [];
  for (const a of issue.actions ?? [])
    result.push({
      actionId: a.id,
      descriptorCode: a.descriptor.code,
      descriptorName: a.descriptor.name,
      shortDesc: a.descriptor.short_desc,
      updatedAt: a.updated_at,
      actionBy: a.action_by,
      actorDetailsName: a.actor_details?.name,
    });
  (issue.issue_actions?.complainant_actions ?? []).forEach((e, i) =>
    result.push({
      actionId: `complainant-${i}`,
      descriptorCode: e.complainant_action ?? "UNKNOWN",
      shortDesc: e.short_desc,
      updatedAt: e.updated_at,
      side: "complainant",
      cascadedLevel: e.cascaded_level,
      actorOrgName: e.updated_by?.org?.name,
      actorPersonName: e.updated_by?.person?.name,
      actorPhone: e.updated_by?.contact?.phone,
      actorEmail: e.updated_by?.contact?.email,
    }),
  );
  (issue.issue_actions?.respondent_actions ?? []).forEach((e, i) =>
    result.push({
      actionId: `respondent-${i}`,
      descriptorCode: e.respondent_action ?? "UNKNOWN",
      shortDesc: e.short_desc,
      updatedAt: e.updated_at,
      side: "respondent",
      cascadedLevel: e.cascaded_level,
      actorOrgName: e.updated_by?.org?.name,
      actorPersonName: e.updated_by?.person?.name,
      actorPhone: e.updated_by?.contact?.phone,
      actorEmail: e.updated_by?.contact?.email,
    }),
  );
  return result;
};

/** Only-defined-fields patch for the `issues` row from either callback shape. */
const buildIssuePatch = (
  issue: OndcIssueObject,
  bpp?: { bppId?: string; bppUri?: string },
) => ({
  ...(bpp?.bppId ? { bppId: bpp.bppId } : {}),
  ...(bpp?.bppUri ? { bppUri: bpp.bppUri } : {}),
  ...(issue.status ? { status: issue.status } : {}),
  ...(issue.level ? { level: issue.level } : {}),
  ...(issue.last_action_id ? { lastActionId: issue.last_action_id } : {}),
  ...(issue.respondent_ids ? { respondentIds: issue.respondent_ids } : {}),
  ...(issue.resolution
    ? {
        resolutionActionTriggered: issue.resolution.action_triggered,
        resolutionShortDesc: issue.resolution.short_desc,
        resolutionLongDesc: issue.resolution.long_desc,
        resolutionRefundAmount: issue.resolution.refund_amount,
      }
    : {}),
  updatedAt: new Date(),
});

export class DrizzleIssueRepository implements IssueRepository {
  constructor(private readonly database: typeof db1 = db1) {}

  async loadOrder(orderId: string) {
    return loadLogisticsOrder(this.database, orderId);
  }

  async findByIssueId(issueId: string): Promise<FullIssue | undefined> {
    const [row] = await this.database
      .select()
      .from(issues)
      .where(eq(issues.issueId, issueId))
      .limit(1);
    if (!row) return undefined;

    const [refs, actors, actions] = await Promise.all([
      this.database.select().from(issueRefs).where(eq(issueRefs.issueId, row.id)),
      this.database.select().from(issueActors).where(eq(issueActors.issueId, row.id)),
      this.database
        .select()
        .from(issueActions)
        .where(eq(issueActions.issueId, row.id))
        .orderBy(issueActions.createdAt),
    ]);

    return {
      id: row.id,
      issueId: row.issueId,
      transactionId: row.transactionId,
      orderId: row.orderId,
      bppId: row.bppId ?? undefined,
      bppUri: row.bppUri ?? undefined,
      categoryCode: row.categoryCode,
      descriptorCode: row.descriptorCode,
      status: row.status,
      level: row.level,
      shortDesc: row.shortDesc ?? undefined,
      longDesc: row.longDesc ?? undefined,
      additionalDescUrl: row.additionalDescUrl ?? undefined,
      additionalDescContentType: row.additionalDescContentType ?? undefined,
      respondentIds: row.respondentIds ?? undefined,
      sourceId: row.sourceId ?? undefined,
      complainantId: row.complainantId ?? undefined,
      expectedResponseDuration: row.expectedResponseDuration ?? undefined,
      expectedResolutionDuration: row.expectedResolutionDuration ?? undefined,
      lastActionId: row.lastActionId ?? undefined,
      createdAt: row.createdAt.toISOString(),
      refs: refs.map((r) => ({
        refId: r.refId,
        refType: r.refType,
        quantityCount: r.quantityCount ?? undefined,
      })),
      actors: actors.map((a) => ({
        actorId: a.actorId,
        actorType: a.actorType,
        orgName: a.orgName ?? undefined,
        personName: a.personName ?? undefined,
        contactPhone: a.contactPhone ?? undefined,
        contactEmail: a.contactEmail ?? undefined,
      })),
      actions: actions.map((a) => ({
        actionId: a.actionId,
        descriptorCode: a.descriptorCode,
        descriptorName: a.descriptorName ?? undefined,
        shortDesc: a.shortDesc ?? undefined,
        updatedAt: (a.updatedAt ?? a.createdAt).toISOString(),
        actionBy: a.actionBy ?? "",
        actorDetailsName: a.actorDetailsName ?? undefined,
        resolutionId: a.resolutionId ?? undefined,
        side: a.side ?? undefined,
        actorOrgName: a.actorOrgName ?? undefined,
        actorPersonName: a.actorPersonName ?? undefined,
        actorPhone: a.actorPhone ?? undefined,
        actorEmail: a.actorEmail ?? undefined,
      })),
    };
  }

  async getIssueDetails(issueId: string): Promise<IssueDetails | undefined> {
    const [row] = await this.database
      .select()
      .from(issues)
      .where(eq(issues.issueId, issueId))
      .limit(1);
    if (!row) return undefined;

    const [refs, actors, actions] = await Promise.all([
      this.database.select().from(issueRefs).where(eq(issueRefs.issueId, row.id)),
      this.database.select().from(issueActors).where(eq(issueActors.issueId, row.id)),
      this.database.select().from(issueActions).where(eq(issueActions.issueId, row.id)),
    ]);

    const hasResolution =
      row.resolutionActionTriggered ||
      row.resolutionShortDesc ||
      row.resolutionLongDesc ||
      row.resolutionRefundAmount;

    const actorById = new Map(actors.map((a) => [a.actorId, a]));
    const provider = actorById.get(RESOLUTION_PROVIDER_ACTOR);
    const support = actorById.get(RESOLUTION_SUPPORT_ACTOR);
    const gros = actors
      .filter((a) => a.actorId.startsWith(GRO_ACTOR_PREFIX))
      .sort((x, y) => x.actorId.localeCompare(y.actorId, undefined, { numeric: true }));
    const respondentStatus = actions
      .filter((a) => a.side === "respondent")
      .sort((x, y) =>
        (x.updatedAt ?? x.createdAt).getTime() - (y.updatedAt ?? y.createdAt).getTime(),
      )
      .at(-1)?.descriptorCode;

    return {
      issueId: row.issueId,
      orderId: row.orderId,
      transactionId: row.transactionId,
      bppId: row.bppId ?? undefined,
      categoryCode: row.categoryCode,
      subCategory: row.descriptorCode,
      status: row.status,
      issueType: row.level,
      ...(respondentStatus ? { respondentStatus } : {}),
      rating: row.rating ?? undefined,
      shortDesc: row.shortDesc ?? undefined,
      longDesc: row.longDesc ?? undefined,
      additionalDescUrl: row.additionalDescUrl ?? undefined,
      expectedResponseDuration: row.expectedResponseDuration ?? undefined,
      expectedResolutionDuration: row.expectedResolutionDuration ?? undefined,
      ...(provider || support || gros.length || row.resolutionSupportChatLink
        ? {
            resolutionProvider: {
              type: provider?.actorType,
              ...(provider
                ? {
                    organization: {
                      orgName: provider.orgName ?? undefined,
                      personName: provider.personName ?? undefined,
                      phone: provider.contactPhone ?? undefined,
                      email: provider.contactEmail ?? undefined,
                    },
                  }
                : {}),
              ...(support || row.resolutionSupportChatLink
                ? {
                    support: {
                      chatLink: row.resolutionSupportChatLink ?? undefined,
                      phone: support?.contactPhone ?? undefined,
                      email: support?.contactEmail ?? undefined,
                    },
                  }
                : {}),
              gros: gros.map((g) => ({
                groType: g.actorType,
                personName: g.personName ?? undefined,
                phone: g.contactPhone ?? undefined,
                email: g.contactEmail ?? undefined,
              })),
            },
          }
        : {}),
      ...(hasResolution
        ? {
            resolution: {
              actionTriggered: row.resolutionActionTriggered ?? undefined,
              shortDesc: row.resolutionShortDesc ?? undefined,
              longDesc: row.resolutionLongDesc ?? undefined,
              refundAmount: row.resolutionRefundAmount ?? undefined,
            },
          }
        : {}),
      refs: refs.map((r) => ({
        refId: r.refId,
        refType: r.refType,
        quantityCount: r.quantityCount ?? undefined,
      })),
      actors: actors
        .filter((a) => !isResolutionProviderActor(a.actorId))
        .map((a) => ({
          actorId: a.actorId,
          actorType: a.actorType,
          orgName: a.orgName ?? undefined,
          personName: a.personName ?? undefined,
          contactPhone: a.contactPhone ?? undefined,
          contactEmail: a.contactEmail ?? undefined,
        })),
      // Timeline order: the action's own updated_at from the payload, falling
      // back to insert time for rows that don't carry one.
      actions: actions
        .map((a) => ({
          actionId: a.actionId,
          side: a.side ?? undefined,
          cascadedLevel: a.cascadedLevel ?? undefined,
          code: a.descriptorCode,
          name: a.descriptorName ?? undefined,
          shortDesc: a.shortDesc ?? undefined,
          updatedAt: (a.updatedAt ?? a.createdAt).toISOString(),
          actionBy: a.actionBy ?? undefined,
          actorName: a.actorDetailsName ?? undefined,
          actorOrgName: a.actorOrgName ?? undefined,
          actorPersonName: a.actorPersonName ?? undefined,
          actorPhone: a.actorPhone ?? undefined,
          actorEmail: a.actorEmail ?? undefined,
          resolutionId: a.resolutionId ?? undefined,
        }))
        .sort((x, y) => x.updatedAt.localeCompare(y.updatedAt)),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async listIssuesByOrder(orderId: string): Promise<IssueSummary[]> {
    const rows = await this.database
      .select()
      .from(issues)
      .where(eq(issues.orderId, orderId))
      .orderBy(desc(issues.createdAt));
    return rows.map((row) => ({
      issueId: row.issueId,
      categoryCode: row.categoryCode,
      subCategory: row.descriptorCode,
      status: row.status,
      issueType: row.level,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  async createIssue({ payload, orderId, categoryCode, initialAction }: CreateIssueParams) {
    const existing = await this.database
      .select({ id: ondcTransactions.id })
      .from(ondcTransactions)
      .where(
        and(
          eq(ondcTransactions.transactionId, payload.context.transaction_id),
          eq(ondcTransactions.messageId, payload.context.message_id),
          eq(ondcTransactions.action, "issue"),
          eq(ondcTransactions.orderId, orderId),
        ),
      )
      .limit(1);
    if (existing.length > 0) return { created: false };

    const issue = payload.message.issue;
    // Only ever receives payloads WE built (buildIssuePayload, IGM 1.0.0 create)
    // — sub_category/description/order_details/complainant_info are always set.
    if (!issue.sub_category || !issue.description || !issue.order_details || !issue.complainant_info)
      throw new Error("outbound /issue create payload is missing 1.0.0 fields");
    const subCategory = issue.sub_category;
    const description = issue.description;
    const details = issue.order_details;
    // order_details is kept as issue_refs so GET /logistics/issues/:id shows it.
    const refs = [
      { refId: details.id, refType: "ORDER" },
      ...(details.provider_id ? [{ refId: details.provider_id, refType: "PROVIDER" }] : []),
      ...(details.fulfillments ?? []).map((f) => ({ refId: f.id, refType: "FULFILLMENT" })),
      ...(details.items ?? []).map((i) => ({
        refId: i.id,
        refType: "ITEM",
        quantityCount: String(i.quantity),
      })),
    ];
    const complainant = issue.complainant_info;

    console.log("[issue.repository] persisting /issue (create)", {
      issueId: issue.id,
      orderId,
      transactionId: payload.context.transaction_id,
      messageId: payload.context.message_id,
    });

    await this.database.transaction(async (tx) => {
      const [row] = await tx
        .insert(issues)
        .values({
          issueId: issue.id,
          transactionId: payload.context.transaction_id,
          orderId,
          bppId: payload.context.bpp_id,
          bppUri: payload.context.bpp_uri,
          categoryCode,
          descriptorCode: subCategory,
          status: issue.status,
          level: issue.issue_type ?? "ISSUE",
          shortDesc: description.short_desc,
          longDesc: description.long_desc,
          additionalDescUrl: description.additional_desc?.url,
          additionalDescContentType: description.additional_desc?.content_type,
          sourceId: issue.source?.network_participant_id,
          expectedResponseDuration: issue.expected_response_time?.duration,
          expectedResolutionDuration: issue.expected_resolution_time?.duration,
          lastActionId: initialAction.actionId,
        })
        .returning({ id: issues.id });

      await tx
        .insert(issueRefs)
        .values(refs.map((r) => ({ issueId: row.id, ...r })));

      await tx.insert(issueActors).values({
        issueId: row.id,
        actorId: "complainant",
        actorType: "COMPLAINANT",
        personName: complainant.person.name,
        contactPhone: complainant.contact.phone,
        contactEmail: complainant.contact.email,
      });

      await tx.insert(issueActions).values({
        issueId: row.id,
        actionId: initialAction.actionId,
        side: initialAction.side,
        descriptorCode: initialAction.descriptorCode,
        shortDesc: initialAction.shortDesc,
        updatedAt: new Date(initialAction.updatedAt),
        actionBy: initialAction.actionBy,
        actorOrgName: initialAction.actorOrgName,
        actorPersonName: initialAction.actorPersonName,
        actorPhone: initialAction.actorPhone,
        actorEmail: initialAction.actorEmail,
      });

      await tx.insert(ondcTransactions).values({
        transactionId: payload.context.transaction_id,
        messageId: payload.context.message_id,
        action: "issue",
        orderId,
        status: "pending",
        domain: payload.context.domain,
        country: payload.context.country,
        city: payload.context.city,
        coreVersion: payload.context.core_version,
        bapId: payload.context.bap_id,
        bapUri: payload.context.bap_uri,
        bppId: payload.context.bpp_id,
        bppUri: payload.context.bpp_uri,
        timestamp: new Date(payload.context.timestamp),
        ttl: payload.context.ttl,
      });
    });
    return { created: true };
  }

  async appendIssueAction({
    issueRowId,
    payload,
    orderId,
    action,
    nextStatus,
    nextIssueType,
    rating,
  }: AppendIssueActionParams) {
    const existing = await this.database
      .select({ id: ondcTransactions.id })
      .from(ondcTransactions)
      .where(
        and(
          eq(ondcTransactions.transactionId, payload.context.transaction_id),
          eq(ondcTransactions.messageId, payload.context.message_id),
          eq(ondcTransactions.action, "issue"),
          eq(ondcTransactions.orderId, orderId),
        ),
      )
      .limit(1);
    if (existing.length > 0) return { created: false };

    console.log("[issue.repository] persisting /issue (update)", {
      issueId: payload.message.issue.id,
      actionId: action.actionId,
      descriptorCode: action.descriptorCode,
      transactionId: payload.context.transaction_id,
      messageId: payload.context.message_id,
    });

    await this.database.transaction(async (tx) => {
      await tx.insert(issueActions).values({
        issueId: issueRowId,
        actionId: action.actionId,
        side: action.side,
        descriptorCode: action.descriptorCode,
        shortDesc: action.shortDesc,
        updatedAt: new Date(action.updatedAt),
        actionBy: action.actionBy,
        actorOrgName: action.actorOrgName,
        actorPersonName: action.actorPersonName,
        actorPhone: action.actorPhone,
        actorEmail: action.actorEmail,
      });

      await tx
        .update(issues)
        .set({
          status: nextStatus,
          level: nextIssueType,
          lastActionId: action.actionId,
          ...(rating !== undefined ? { rating } : {}),
          updatedAt: new Date(),
        })
        .where(eq(issues.id, issueRowId));

      await tx.insert(ondcTransactions).values({
        transactionId: payload.context.transaction_id,
        messageId: payload.context.message_id,
        action: "issue",
        orderId,
        status: "pending",
        domain: payload.context.domain,
        country: payload.context.country,
        city: payload.context.city,
        coreVersion: payload.context.core_version,
        bapId: payload.context.bap_id,
        bapUri: payload.context.bap_uri,
        bppId: payload.context.bpp_id,
        bppUri: payload.context.bpp_uri,
        timestamp: new Date(payload.context.timestamp),
        ttl: payload.context.ttl,
      });
    });
    return { created: true };
  }

  async createIssueStatusCheck(payload: OndcIssueStatusRequest, orderId: string) {
    const existing = await this.database
      .select({ id: ondcTransactions.id })
      .from(ondcTransactions)
      .where(
        and(
          eq(ondcTransactions.transactionId, payload.context.transaction_id),
          eq(ondcTransactions.messageId, payload.context.message_id),
          eq(ondcTransactions.action, "issue_status"),
          eq(ondcTransactions.orderId, orderId),
        ),
      )
      .limit(1);
    if (existing.length > 0) return { created: false };

    console.log("[issue.repository] persisting /issue_status", {
      issueId: payload.message.issue_id,
      orderId,
      transactionId: payload.context.transaction_id,
      messageId: payload.context.message_id,
    });
    await this.database.insert(ondcTransactions).values({
      transactionId: payload.context.transaction_id,
      messageId: payload.context.message_id,
      action: "issue_status",
      orderId,
      status: "pending",
      domain: payload.context.domain,
      country: payload.context.country,
      city: payload.context.city,
      coreVersion: payload.context.core_version,
      bapId: payload.context.bap_id,
      bapUri: payload.context.bap_uri,
      bppId: payload.context.bpp_id,
      bppUri: payload.context.bpp_uri,
      timestamp: new Date(payload.context.timestamp),
      ttl: payload.context.ttl,
    });
    return { created: true };
  }

  async updateStatus(
    transactionId: string,
    messageId: string,
    action: "issue" | "issue_status",
    status: string,
    error?: { code?: string; message?: string },
  ) {
    await this.database
      .update(ondcTransactions)
      .set({
        status,
        errorCode: error?.code,
        errorMessage: error?.message,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(ondcTransactions.transactionId, transactionId),
          eq(ondcTransactions.messageId, messageId),
          eq(ondcTransactions.action, action),
        ),
      );
  }

  // /on_issue is treated defensively as solicited-or-unsolicited (an
  // on-network counterparty can, per the IGM design, push an issue update
  // without a matching outbound /issue of ours) — same dual-branch
  // correlation cancel.repository.ts uses for /on_cancel, keyed by issue_id
  // instead of order_id.
  async handleOnIssue(
    response: OndcOnIssueResponse,
    stream: CallbackStream = clientStreamManager,
  ): Promise<IssueCallbackResult> {
    const c = response.context;
    const incomingIssueId = response.message?.issue?.id;
    console.log("[issue.repository] looking up /on_issue", {
      transactionId: c.transaction_id,
      messageId: c.message_id,
      bppId: c.bpp_id,
      incomingIssueId,
      hasError: Boolean(response.error),
    });

    const [pending] = await this.database
      .select({
        callbackTimestamp: ondcTransactions.callbackTimestamp,
        bppId: ondcTransactions.bppId,
      })
      .from(ondcTransactions)
      .where(
        and(
          eq(ondcTransactions.transactionId, c.transaction_id),
          eq(ondcTransactions.action, "issue"),
          eq(ondcTransactions.messageId, c.message_id),
        ),
      )
      .limit(1);

    if (pending) {
      if (pending.callbackTimestamp) {
        console.log("[issue.repository] duplicate solicited /on_issue callback", {
          transactionId: c.transaction_id,
          messageId: c.message_id,
        });
        return "duplicate";
      }
      if (pending.bppId && c.bpp_id && pending.bppId !== c.bpp_id) {
        console.log("[issue.repository] /on_issue bpp_id mismatch", {
          transactionId: c.transaction_id,
          expectedBppId: pending.bppId,
          receivedBppId: c.bpp_id,
        });
        return "invalid_bpp";
      }
    }

    if (!incomingIssueId) {
      console.log("[issue.repository] /on_issue missing issue.id", {
        transactionId: c.transaction_id,
      });
      return "not_found";
    }
    const [issueRow] = await this.database
      .select()
      .from(issues)
      .where(eq(issues.issueId, incomingIssueId))
      .limit(1);
    if (!issueRow) {
      console.log("[issue.repository] unknown issue for /on_issue", {
        transactionId: c.transaction_id,
        incomingIssueId,
      });
      return "not_found";
    }
    if (issueRow.bppId && c.bpp_id && issueRow.bppId !== c.bpp_id) {
      console.log("[issue.repository] /on_issue bpp_id mismatch (issue row)", {
        transactionId: c.transaction_id,
        expectedBppId: issueRow.bppId,
        receivedBppId: c.bpp_id,
      });
      return "invalid_bpp";
    }

    if (!pending) {
      // Unsolicited push — dedupe by an existing audit row for this exact
      // (transaction_id, message_id, action) rather than a message_id match
      // on a *pending* row (there is none to match).
      const [existingAudit] = await this.database
        .select({ id: ondcTransactions.id })
        .from(ondcTransactions)
        .where(
          and(
            eq(ondcTransactions.transactionId, c.transaction_id),
            eq(ondcTransactions.messageId, c.message_id),
            eq(ondcTransactions.action, "issue"),
          ),
        )
        .limit(1);
      if (existingAudit) {
        console.log("[issue.repository] duplicate unsolicited /on_issue callback", {
          transactionId: c.transaction_id,
          messageId: c.message_id,
        });
        return "duplicate";
      }
    }

    const incomingActions = response.message?.issue
      ? collectIncomingActions(response.message.issue)
      : [];
    const existingActionIds = new Set(
      (
        await this.database
          .select({ actionId: issueActions.actionId })
          .from(issueActions)
          .where(eq(issueActions.issueId, issueRow.id))
      ).map((a) => a.actionId),
    );
    const newActions = incomingActions.filter((a) => !existingActionIds.has(a.actionId));

    await this.database.transaction(async (tx) => {
      if (newActions.length)
        await tx.insert(issueActions).values(
          newActions.map((a) => ({
            issueId: issueRow.id,
            actionId: a.actionId,
            side: a.side,
            cascadedLevel: a.cascadedLevel,
            descriptorCode: a.descriptorCode,
            descriptorName: a.descriptorName,
            shortDesc: a.shortDesc,
            updatedAt: new Date(a.updatedAt),
            actionBy: a.actionBy,
            actorDetailsName: a.actorDetailsName,
            actorOrgName: a.actorOrgName,
            actorPersonName: a.actorPersonName,
            actorPhone: a.actorPhone,
            actorEmail: a.actorEmail,
          })),
        );

      if (!response.error && response.message?.issue) {
        await tx
          .update(issues)
          .set(buildIssuePatch(response.message.issue, { bppId: c.bpp_id, bppUri: c.bpp_uri }))
          .where(eq(issues.id, issueRow.id));
        await persistResolutionProvider(
          tx,
          issueRow.id,
          response.message.issue.resolution_provider,
        );
      }

      if (pending) {
        await tx
          .update(ondcTransactions)
          .set({
            status: response.error ? "failed" : "completed",
            callbackMessageId: c.message_id,
            callbackTimestamp: new Date(c.timestamp),
            bppId: c.bpp_id,
            bppUri: c.bpp_uri,
            errorCode: response.error?.code as string | undefined,
            errorMessage: response.error?.message as string | undefined,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(ondcTransactions.transactionId, c.transaction_id),
              eq(ondcTransactions.action, "issue"),
              eq(ondcTransactions.messageId, c.message_id),
            ),
          );
      } else {
        await tx.insert(ondcTransactions).values({
          transactionId: c.transaction_id,
          messageId: c.message_id,
          action: "issue",
          orderId: issueRow.orderId,
          status: response.error ? "failed" : "completed",
          bppId: c.bpp_id,
          bppUri: c.bpp_uri,
          timestamp: new Date(c.timestamp),
          callbackMessageId: c.message_id,
          callbackTimestamp: new Date(c.timestamp),
          errorCode: response.error?.code as string | undefined,
          errorMessage: response.error?.message as string | undefined,
        });
      }
    });

    console.log("[issue.repository] /on_issue persisted", {
      transactionId: c.transaction_id,
      issueId: incomingIssueId,
      newActionCount: newActions.length,
    });
    if (response.error) {
      stream.push(c.transaction_id, "issue_error", {
        issueId: incomingIssueId,
        orderId: issueRow.orderId,
        code: response.error.code,
        message: response.error.message,
      });
    } else {
      stream.push(c.transaction_id, "issue_updated", {
        issueId: incomingIssueId,
        orderId: issueRow.orderId,
        newActionCount: newActions.length,
      });
    }
    return "processed";
  }

  // /on_issue_status is solicited-or-unsolicited: a reply to our
  // /issue_status poll is correlated by (transaction_id, action, message_id)
  // the same way track/update's /on_track|/on_update do; a status pushed
  // without one is correlated by issue_id, like unsolicited /on_issue.
  async handleOnIssueStatus(
    response: OndcOnIssueStatusResponse,
    stream: CallbackStream = clientStreamManager,
  ): Promise<IssueCallbackResult> {
    const c = response.context;
    console.log("[issue.repository] looking up /on_issue_status", {
      transactionId: c.transaction_id,
      messageId: c.message_id,
      bppId: c.bpp_id,
      hasError: Boolean(response.error),
    });

    const [pending] = await this.database
      .select({
        orderId: ondcTransactions.orderId,
        callbackTimestamp: ondcTransactions.callbackTimestamp,
        bppId: ondcTransactions.bppId,
      })
      .from(ondcTransactions)
      .where(
        and(
          eq(ondcTransactions.transactionId, c.transaction_id),
          eq(ondcTransactions.action, "issue_status"),
          eq(ondcTransactions.messageId, c.message_id),
        ),
      )
      .limit(1);
    if (pending) {
      if (pending.callbackTimestamp) {
        console.log("[issue.repository] duplicate /on_issue_status callback", {
          transactionId: c.transaction_id,
          messageId: c.message_id,
        });
        return "duplicate";
      }
      if (pending.bppId && c.bpp_id && pending.bppId !== c.bpp_id) {
        console.log("[issue.repository] /on_issue_status bpp_id mismatch", {
          transactionId: c.transaction_id,
          expectedBppId: pending.bppId,
          receivedBppId: c.bpp_id,
        });
        return "invalid_bpp";
      }
    }

    const incomingIssueId = response.message?.issue?.id;
    const [issueRow] = incomingIssueId
      ? await this.database
          .select({ id: issues.id, orderId: issues.orderId, bppId: issues.bppId })
          .from(issues)
          .where(eq(issues.issueId, incomingIssueId))
          .limit(1)
      : [];

    if (!pending) {
      if (!issueRow) {
        console.log("[issue.repository] unsolicited /on_issue_status for unknown issue", {
          transactionId: c.transaction_id,
          incomingIssueId,
        });
        return "not_found";
      }
      if (issueRow.bppId && c.bpp_id && issueRow.bppId !== c.bpp_id) {
        console.log("[issue.repository] /on_issue_status bpp_id mismatch (issue row)", {
          transactionId: c.transaction_id,
          expectedBppId: issueRow.bppId,
          receivedBppId: c.bpp_id,
        });
        return "invalid_bpp";
      }
      // Unsolicited push — dedupe by an existing audit row for this exact
      // (transaction_id, message_id, action); there is no pending row to match.
      const [existingAudit] = await this.database
        .select({ id: ondcTransactions.id })
        .from(ondcTransactions)
        .where(
          and(
            eq(ondcTransactions.transactionId, c.transaction_id),
            eq(ondcTransactions.messageId, c.message_id),
            eq(ondcTransactions.action, "issue_status"),
          ),
        )
        .limit(1);
      if (existingAudit) {
        console.log("[issue.repository] duplicate unsolicited /on_issue_status callback", {
          transactionId: c.transaction_id,
          messageId: c.message_id,
        });
        return "duplicate";
      }
    }
    const orderId = pending?.orderId ?? issueRow?.orderId;

    const incomingActions = response.message?.issue
      ? collectIncomingActions(response.message.issue)
      : [];
    const existingActionIds = issueRow
      ? new Set(
          (
            await this.database
              .select({ actionId: issueActions.actionId })
              .from(issueActions)
              .where(eq(issueActions.issueId, issueRow.id))
          ).map((a) => a.actionId),
        )
      : new Set<string>();
    const newActions = incomingActions.filter((a) => !existingActionIds.has(a.actionId));

    await this.database.transaction(async (tx) => {
      if (issueRow && newActions.length)
        await tx.insert(issueActions).values(
          newActions.map((a) => ({
            issueId: issueRow.id,
            actionId: a.actionId,
            side: a.side,
            cascadedLevel: a.cascadedLevel,
            descriptorCode: a.descriptorCode,
            descriptorName: a.descriptorName,
            shortDesc: a.shortDesc,
            updatedAt: new Date(a.updatedAt),
            actionBy: a.actionBy,
            actorDetailsName: a.actorDetailsName,
            actorOrgName: a.actorOrgName,
            actorPersonName: a.actorPersonName,
            actorPhone: a.actorPhone,
            actorEmail: a.actorEmail,
          })),
        );

      if (issueRow && !response.error && response.message?.issue) {
        await tx
          .update(issues)
          .set(buildIssuePatch(response.message.issue))
          .where(eq(issues.id, issueRow.id));
        await persistResolutionProvider(
          tx,
          issueRow.id,
          response.message.issue.resolution_provider,
        );
      }

      if (pending) {
        await tx
          .update(ondcTransactions)
          .set({
            status: response.error ? "failed" : "completed",
            callbackMessageId: c.message_id,
            callbackTimestamp: new Date(c.timestamp),
            bppId: c.bpp_id,
            bppUri: c.bpp_uri,
            errorCode: response.error?.code as string | undefined,
            errorMessage: response.error?.message as string | undefined,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(ondcTransactions.transactionId, c.transaction_id),
              eq(ondcTransactions.action, "issue_status"),
              eq(ondcTransactions.messageId, c.message_id),
            ),
          );
      } else {
        await tx.insert(ondcTransactions).values({
          transactionId: c.transaction_id,
          messageId: c.message_id,
          action: "issue_status",
          orderId,
          status: response.error ? "failed" : "completed",
          bppId: c.bpp_id,
          bppUri: c.bpp_uri,
          timestamp: new Date(c.timestamp),
          callbackMessageId: c.message_id,
          callbackTimestamp: new Date(c.timestamp),
          errorCode: response.error?.code as string | undefined,
          errorMessage: response.error?.message as string | undefined,
        });
      }
    });

    console.log("[issue.repository] /on_issue_status persisted", {
      transactionId: c.transaction_id,
      issueId: incomingIssueId,
      solicited: Boolean(pending),
      newActionCount: newActions.length,
    });
    if (response.error) {
      stream.push(c.transaction_id, "issue_status_error", {
        issueId: incomingIssueId,
        orderId,
        code: response.error.code,
        message: response.error.message,
      });
    } else {
      stream.push(c.transaction_id, "issue_status_updated", {
        issueId: incomingIssueId,
        orderId,
        newActionCount: newActions.length,
      });
    }
    return "processed";
  }
}
