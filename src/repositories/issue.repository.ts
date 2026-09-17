import { and, eq } from "drizzle-orm";
import { db1 } from "../db/index.js";
import {
  issueActions,
  issueActors,
  issueRefs,
  issues,
  ondcTransactions,
} from "../db/schema/index.js";
import { loadLogisticsOrder, type LogisticsOrderRow } from "./logistics-order-shared.js";
import type {
  OndcIssueObject,
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
  nextLevel: string;
  nextLongDesc?: string;
}

export interface IssueRepository {
  loadOrder(orderId: string): Promise<LogisticsOrderRow | undefined>;
  findByIssueId(issueId: string): Promise<FullIssue | undefined>;
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
  handleOnIssue(response: OndcOnIssueResponse): Promise<IssueCallbackResult>;
  handleOnIssueStatus(
    response: OndcOnIssueStatusResponse,
  ): Promise<IssueCallbackResult>;
}

const refQuantityCount = (ref: { tags?: { descriptor: { code: string }; list: { descriptor: { code: string }; value: string }[] }[] }) =>
  ref.tags
    ?.find((t) => t.descriptor.code === "message.order.items")
    ?.list.find((l) => l.descriptor.code === "quantity.selected.count")?.value;

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
      })),
    };
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
    // This method only ever receives payloads WE built (buildIssuePayload,
    // the flat outbound shape) — descriptor/status/level are always present
    // there, unlike the more permissive inbound OndcIssueObject type shared
    // with /on_issue|/on_issue_status.
    if (!issue.descriptor || !issue.status || !issue.level)
      throw new Error("outbound /issue payload is missing descriptor/status/level");
    const descriptor = issue.descriptor;
    const refs = issue.refs ?? [];
    const actors = issue.actors ?? [];

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
          descriptorCode: descriptor.code,
          status: issue.status,
          level: issue.level,
          shortDesc: descriptor.short_desc,
          longDesc: descriptor.long_desc,
          additionalDescUrl: descriptor.additional_desc?.url,
          additionalDescContentType: descriptor.additional_desc?.content_type,
          sourceId: issue.source_id,
          complainantId: issue.complainant_id,
          expectedResponseDuration: issue.expected_response_time?.duration,
          expectedResolutionDuration: issue.expected_resolution_time?.duration,
          lastActionId: issue.last_action_id,
        })
        .returning({ id: issues.id });

      if (refs.length)
        await tx.insert(issueRefs).values(
          refs.map((r) => ({
            issueId: row.id,
            refId: r.ref_id,
            refType: r.ref_type,
            quantityCount: refQuantityCount(r),
          })),
        );

      if (actors.length)
        await tx.insert(issueActors).values(
          actors.map((a) => ({
            issueId: row.id,
            actorId: a.id,
            actorType: a.type,
            orgName: a.info?.org?.name,
            personName: a.info?.person?.name,
            contactPhone: a.info?.contact?.phone,
            contactEmail: a.info?.contact?.email,
          })),
        );

      await tx.insert(issueActions).values({
        issueId: row.id,
        actionId: initialAction.actionId,
        descriptorCode: initialAction.descriptorCode,
        descriptorName: initialAction.descriptorName,
        shortDesc: initialAction.shortDesc,
        updatedAt: new Date(initialAction.updatedAt),
        actionBy: initialAction.actionBy,
        actorDetailsName: initialAction.actorDetailsName,
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
    nextLevel,
    nextLongDesc,
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
        descriptorCode: action.descriptorCode,
        descriptorName: action.descriptorName,
        shortDesc: action.shortDesc,
        updatedAt: new Date(action.updatedAt),
        actionBy: action.actionBy,
        actorDetailsName: action.actorDetailsName,
        resolutionId: action.resolutionId,
      });

      await tx
        .update(issues)
        .set({
          status: nextStatus,
          level: nextLevel,
          lastActionId: action.actionId,
          ...(nextLongDesc !== undefined ? { longDesc: nextLongDesc } : {}),
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
  async handleOnIssue(response: OndcOnIssueResponse): Promise<IssueCallbackResult> {
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
    return "processed";
  }

  // /on_issue_status is always solicited — it's a direct reply to our
  // /issue_status poll, correlated by (transaction_id, action, message_id)
  // the same way track/update's /on_track|/on_update do.
  async handleOnIssueStatus(
    response: OndcOnIssueStatusResponse,
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
    if (!pending) {
      console.log("[issue.repository] /on_issue_status has no matching /issue_status", {
        transactionId: c.transaction_id,
      });
      return "not_found";
    }
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

    const incomingIssueId = response.message?.issue?.id;
    const [issueRow] = incomingIssueId
      ? await this.database
          .select({ id: issues.id })
          .from(issues)
          .where(eq(issues.issueId, incomingIssueId))
          .limit(1)
      : [];

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
      }

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
    });

    console.log("[issue.repository] /on_issue_status persisted", {
      transactionId: c.transaction_id,
      issueId: incomingIssueId,
      newActionCount: newActions.length,
    });
    return "processed";
  }
}
