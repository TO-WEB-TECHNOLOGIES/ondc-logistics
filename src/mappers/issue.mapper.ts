/**
 * Mapper for /issue, /issue_status — IGM MVP v1.0.0.
 *
 * Contract reference: tasks/ONDC API Contract for IGM_MVP_v1.0.0 - Google Docs.pdf,
 * Scenario 1 (complaint related to an item):
 *   1.  /issue create                     → buildIssuePayload
 *   3.  /issue_status                     → buildIssueStatusPayload
 *   5a. /issue close (CLOSE + rating)     → buildIssueUpdatePayload
 *   5b. /issue escalate (ESCALATE)        → buildIssueUpdatePayload
 * Only 1.0.0 attributes are emitted — the ONDC reviewer rejected payloads that
 * mixed 1.0.0 and 2.0.0 (refs/actors/descriptor/actions/level/...).
 */
import { buildRequestContext } from "../utils/ondc-context.js";
import { SUBSCRIBER_ID } from "../constants/v1/appConstants.js";
import type { IssueCategory } from "../constants/issueCategories.js";
import type { OndcContext } from "../types/search/ondc.js";
import type { FullIssue, IssueActionRow } from "../repositories/issue.repository.js";
import type {
  IssueRating,
  IssueUpdateActionCode,
  OndcIssueActionEntry,
  OndcIssueActionUpdatedBy,
  OndcIssueRequest,
  OndcIssueStatusRequest,
} from "../schemas/issue.schema.js";

// No BAP support-contact config exists yet in this repo — read from env with
// obvious placeholders so this is easy to grep for and replace with real values.
// Sent as complainant_actions[].updated_by (the interfacing app's representative).
const BAP_SUPPORT_NAME = process.env.BAP_SUPPORT_NAME || "Support";
const BAP_SUPPORT_PHONE = process.env.BAP_SUPPORT_PHONE || "9999999999";
const BAP_SUPPORT_EMAIL = process.env.BAP_SUPPORT_EMAIL || "support@example.com";

// IGM policy maximums (contract footnote 18); buyer apps may shorten them.
const EXPECTED_RESPONSE_TIME = "PT2H";
const EXPECTED_RESOLUTION_TIME = "P1D";

const DEFAULT_ACTION_SHORT_DESC: Record<"OPEN" | IssueUpdateActionCode, string> = {
  OPEN: "Complaint created",
  CLOSE: "Complaint closed",
  ESCALATE: "Escalated to grievance",
};

type ContextBase = Pick<
  OndcContext,
  "domain" | "country" | "city" | "core_version" | "bap_id" | "bap_uri"
>;

/** updated_by for our own complainant actions: org name is "subscriber_id::domain". */
const complainantUpdatedBy = (domain: string): OndcIssueActionUpdatedBy => ({
  org: { name: `${SUBSCRIBER_ID}::${domain}` },
  contact: { phone: BAP_SUPPORT_PHONE, email: BAP_SUPPORT_EMAIL },
  person: { name: BAP_SUPPORT_NAME },
});

/** A stored complainant action → its 1.0.0 wire entry. */
const complainantEntry = (a: IssueActionRow, domain: string): OndcIssueActionEntry => {
  const fallback = complainantUpdatedBy(domain);
  return {
    complainant_action: a.descriptorCode,
    ...(a.shortDesc ? { short_desc: a.shortDesc } : {}),
    updated_at: a.updatedAt,
    updated_by: {
      org: { name: a.actorOrgName ?? fallback.org!.name },
      contact: {
        phone: a.actorPhone ?? fallback.contact!.phone,
        email: a.actorEmail ?? fallback.contact!.email,
      },
      person: { name: a.actorPersonName ?? fallback.person!.name },
    },
  };
};

/** The IssueActionRow persisted for a complainant action we send. */
const complainantRow = (
  index: number,
  code: string,
  shortDesc: string,
  updatedAt: string,
  domain: string,
): IssueActionRow => {
  const by = complainantUpdatedBy(domain);
  return {
    // Same id scheme collectIncomingActions synthesizes for echoed
    // complainant_actions, so an echo dedupes against what we stored.
    actionId: `complainant-${index}`,
    side: "complainant",
    descriptorCode: code,
    shortDesc,
    updatedAt,
    actionBy: "",
    actorOrgName: by.org?.name,
    actorPersonName: by.person?.name,
    actorPhone: by.contact?.phone,
    actorEmail: by.contact?.email,
  };
};

// ── CREATE (Scenario 1, step 1) ──────────────────────────────────────────────

export interface BuildIssuePayloadInput {
  issueId: string;
  orderId: string;
  category: IssueCategory & { subCategoryV1: string };
  descriptorLongDesc: string;
  descriptorAdditionalDescUrl?: string;
  images?: string[];
  items: { id: string; quantity: number }[];
  context: ContextBase;
  bppId: string;
  bppUri: string;
  providerId?: string;
  orderState?: string;
  fulfillmentId?: string;
  fulfillmentState?: string;
  billingName?: string;
  billingEmail?: string;
  billingPhone?: string;
  transactionId: string;
  messageId: string;
  now: string;
}

export interface BuildIssuePayloadResult {
  payload: OndcIssueRequest;
  /** The OPEN complainant action, to persist. */
  initialAction: IssueActionRow;
}

export const buildIssuePayload = (input: BuildIssuePayloadInput): BuildIssuePayloadResult => {
  const { category } = input;
  const initialAction = complainantRow(
    0,
    "OPEN",
    DEFAULT_ACTION_SHORT_DESC.OPEN,
    input.now,
    input.context.domain,
  );

  const payload: OndcIssueRequest = {
    context: buildRequestContext("issue", {
      base: input.context,
      bppId: input.bppId,
      bppUri: input.bppUri,
      transactionId: input.transactionId,
      messageId: input.messageId,
      timestamp: input.now,
    }),
    message: {
      issue: {
        id: input.issueId,
        category: category.igmCategory,
        sub_category: category.subCategoryV1,
        complainant_info: {
          person: { name: input.billingName?.trim() || "Customer" },
          contact: {
            phone: input.billingPhone?.trim() || BAP_SUPPORT_PHONE,
            ...(input.billingEmail?.trim() ? { email: input.billingEmail.trim() } : {}),
          },
        },
        order_details: {
          id: input.orderId,
          ...(input.orderState ? { state: input.orderState } : {}),
          ...(input.items.length ? { items: input.items } : {}),
          ...(input.fulfillmentId
            ? {
                fulfillments: [
                  {
                    id: input.fulfillmentId,
                    ...(input.fulfillmentState ? { state: input.fulfillmentState } : {}),
                  },
                ],
              }
            : {}),
          ...(input.providerId ? { provider_id: input.providerId } : {}),
        },
        description: {
          short_desc: category.shortDesc,
          long_desc: input.descriptorLongDesc,
          ...(input.descriptorAdditionalDescUrl
            ? {
                additional_desc: {
                  url: input.descriptorAdditionalDescUrl,
                  content_type: "text/plain",
                },
              }
            : {}),
          ...(input.images?.length ? { images: input.images } : {}),
        },
        source: {
          network_participant_id: `${input.context.bap_id}/ondc`,
          type: "CONSUMER",
        },
        expected_response_time: { duration: EXPECTED_RESPONSE_TIME },
        expected_resolution_time: { duration: EXPECTED_RESOLUTION_TIME },
        status: "OPEN",
        issue_type: "ISSUE",
        issue_actions: {
          complainant_actions: [complainantEntry(initialAction, input.context.domain)],
        },
        created_at: input.now,
        updated_at: input.now,
      },
    },
  };

  return { payload, initialAction };
};

// ── UPDATE: close (5a) / escalate (5b) ──────────────────────────────────────

export interface BuildIssueUpdatePayloadInput {
  existing: FullIssue;
  actionCode: IssueUpdateActionCode;
  rating?: IssueRating;
  shortDesc?: string;
  context: ContextBase;
  transactionId: string;
  messageId: string;
  now: string;
}

export interface BuildIssueUpdatePayloadResult {
  payload: OndcIssueRequest;
  nextStatus: "OPEN" | "CLOSED";
  nextIssueType: "ISSUE" | "GRIEVANCE" | "DISPUTE";
  newAction: IssueActionRow;
}

/** Our previously sent complainant actions, oldest first. */
export const complainantHistory = (existing: FullIssue): IssueActionRow[] =>
  existing.actions
    .filter((a) => a.side === "complainant")
    .sort((x, y) => x.updatedAt.localeCompare(y.updatedAt));

export const buildIssueUpdatePayload = (
  input: BuildIssueUpdatePayloadInput,
): BuildIssueUpdatePayloadResult => {
  const { existing } = input;
  const domain = input.context.domain;
  const history = complainantHistory(existing);
  const nextStatus = input.actionCode === "CLOSE" ? "CLOSED" : "OPEN";
  const nextIssueType =
    input.actionCode === "ESCALATE"
      ? "GRIEVANCE"
      : (existing.level as "ISSUE" | "GRIEVANCE" | "DISPUTE");

  const newAction = complainantRow(
    history.length,
    input.actionCode,
    input.shortDesc ?? DEFAULT_ACTION_SHORT_DESC[input.actionCode],
    input.now,
    domain,
  );

  const payload: OndcIssueRequest = {
    context: buildRequestContext("issue", {
      base: input.context,
      bppId: existing.bppId ?? "",
      bppUri: existing.bppUri ?? "",
      transactionId: input.transactionId,
      messageId: input.messageId,
      timestamp: input.now,
    }),
    message: {
      issue: {
        id: existing.issueId,
        status: nextStatus,
        ...(input.actionCode === "ESCALATE" ? { issue_type: nextIssueType } : {}),
        issue_actions: {
          complainant_actions: [...history, newAction].map((a) => complainantEntry(a, domain)),
        },
        ...(input.rating ? { rating: input.rating } : {}),
        // The original create's created_at — identical to the OPEN action's
        // updated_at we sent (issues.created_at is a DB default, ms apart).
        created_at: history[0]?.updatedAt ?? existing.createdAt,
        updated_at: input.now,
      },
    },
  };

  return { payload, nextStatus, nextIssueType, newAction };
};

// ── STATUS (Scenario 1, step 3) ──────────────────────────────────────────────

export interface BuildIssueStatusPayloadInput {
  issueId: string;
  context: ContextBase;
  bppId: string;
  bppUri: string;
  transactionId: string;
  messageId: string;
  now: string;
}

export const buildIssueStatusPayload = (
  input: BuildIssueStatusPayloadInput,
): OndcIssueStatusRequest => ({
  context: buildRequestContext("issue_status", {
    base: input.context,
    bppId: input.bppId,
    bppUri: input.bppUri,
    transactionId: input.transactionId,
    messageId: input.messageId,
    timestamp: input.now,
  }),
  message: { issue_id: input.issueId },
});
