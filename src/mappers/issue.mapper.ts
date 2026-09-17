/**
 * Mapper for /issue, /issue_status.
 *
 * Contract reference: no IGM section exists in docs/ondc/ondc logistics.docx —
 * shape is taken from src/json/{issue,issue_status}.json (see issue.schema.ts's
 * header comment). The /issue UPDATE shape (buildIssueUpdatePayload) has no
 * local sample at all; it resends the full issue object with the complete
 * actions[] history + one newly appended action, mirroring how /on_issue
 * appends to that same array from the BPP side.
 */
import { SUBSCRIBER_ID } from "../constants/v1/appConstants.js";
import type { IssueCategory } from "../constants/issueCategories.js";
import type { OndcContext } from "../types/search/ondc.js";
import type { FullIssue, IssueActionRow } from "../repositories/issue.repository.js";
import type {
  IssueUpdateActionCode,
  OndcIssueAction,
  OndcIssueActor,
  OndcIssueRef,
  OndcIssueRequest,
  OndcIssueStatusRequest,
} from "../schemas/issue.schema.js";

// No BAP support-contact config exists yet in this repo (unlike the reference
// project's hardcoded org contact) — read from env with obvious placeholders
// so this is easy to grep for and replace with real values.
const BAP_SUPPORT_NAME = process.env.BAP_SUPPORT_NAME || "Support";
const BAP_SUPPORT_PHONE = process.env.BAP_SUPPORT_PHONE || "9999999999";
const BAP_SUPPORT_EMAIL = process.env.BAP_SUPPORT_EMAIL || "support@example.com";

const CONSUMER_ACTOR_ID = "CONSUMER";
const INTERFACING_NP_ACTOR_ID = "ONDC_BAP";

const ACTION_SHORT_DESC: Record<IssueUpdateActionCode, string> = {
  RESOLUTION_ACCEPTED: "Resolution accepted",
  RESOLUTION_REJECTED: "Resolution rejected",
  INFO_PROVIDED: "Additional information provided",
  CLOSED: "Complaint closed",
  OPEN: "Complaint reopened",
  ESCALATED: "Escalated to grievance",
};

type ContextBase = Pick<
  OndcContext,
  "domain" | "country" | "city" | "core_version" | "bap_id" | "bap_uri"
>;

const actionRowToOndc = (a: IssueActionRow): OndcIssueAction => ({
  id: a.actionId,
  descriptor: {
    code: a.descriptorCode,
    ...(a.descriptorName ? { name: a.descriptorName } : {}),
    ...(a.shortDesc ? { short_desc: a.shortDesc } : {}),
  },
  updated_at: a.updatedAt,
  action_by: a.actionBy,
  ...(a.actorDetailsName ? { actor_details: { name: a.actorDetailsName } } : {}),
});

const refToOndc = (r: FullIssue["refs"][number]): OndcIssueRef => ({
  ref_id: r.refId,
  ref_type: r.refType as OndcIssueRef["ref_type"],
  ...(r.quantityCount !== undefined
    ? {
        tags: [
          {
            descriptor: { code: "message.order.items" },
            list: [
              {
                descriptor: { code: "quantity.selected.count" },
                value: r.quantityCount,
              },
            ],
          },
        ],
      }
    : {}),
});

const actorToOndc = (a: FullIssue["actors"][number]): OndcIssueActor => ({
  id: a.actorId,
  type: a.actorType,
  info: {
    ...(a.orgName ? { org: { name: a.orgName } } : {}),
    ...(a.personName ? { person: { name: a.personName } } : {}),
    ...(a.contactPhone || a.contactEmail
      ? {
          contact: {
            ...(a.contactPhone ? { phone: a.contactPhone } : {}),
            ...(a.contactEmail ? { email: a.contactEmail } : {}),
          },
        }
      : {}),
  },
});

// ── CREATE ───────────────────────────────────────────────────────────────────

export interface BuildIssuePayloadInput {
  issueId: string;
  orderId: string;
  category: IssueCategory;
  descriptorLongDesc: string;
  descriptorAdditionalDescUrl?: string;
  images?: { url: string; size_type?: string }[];
  media?: { url: string }[];
  items: { id: string; quantity: number }[];
  context: ContextBase;
  bppId: string;
  bppUri: string;
  providerId?: string;
  fulfillmentId?: string;
  billingName?: string;
  billingEmail?: string;
  billingPhone?: string;
  transactionId: string;
  messageId: string;
  now: string;
}

export const buildIssuePayload = (input: BuildIssuePayloadInput): OndcIssueRequest => {
  const { category } = input;

  const actors: OndcIssueActor[] = [
    {
      id: CONSUMER_ACTOR_ID,
      type: "CONSUMER",
      info: {
        org: { name: `${SUBSCRIBER_ID}::${input.context.domain}` },
        person: { name: input.billingName?.trim() || "Customer" },
        contact: {
          phone: input.billingPhone?.trim() || BAP_SUPPORT_PHONE,
          email: input.billingEmail?.trim() || BAP_SUPPORT_EMAIL,
        },
      },
    },
    {
      id: INTERFACING_NP_ACTOR_ID,
      type: "INTERFACING_NP",
      info: {
        org: { name: `${SUBSCRIBER_ID}::${input.context.domain}` },
        person: { name: BAP_SUPPORT_NAME },
        contact: { phone: BAP_SUPPORT_PHONE, email: BAP_SUPPORT_EMAIL },
      },
    },
  ];

  const refs: OndcIssueRef[] = [];
  if (category.applicableRefs.includes("ORDER"))
    refs.push({ ref_id: input.orderId, ref_type: "ORDER" });
  if (category.applicableRefs.includes("PROVIDER") && input.providerId)
    refs.push({ ref_id: input.providerId, ref_type: "PROVIDER" });
  if (category.applicableRefs.includes("FULFILLMENT") && input.fulfillmentId)
    refs.push({ ref_id: input.fulfillmentId, ref_type: "FULFILLMENT" });
  if (category.applicableRefs.includes("ITEM"))
    for (const item of input.items)
      refs.push({
        ref_id: item.id,
        ref_type: "ITEM",
        tags: [
          {
            descriptor: { code: "message.order.items" },
            list: [
              {
                descriptor: { code: "quantity.selected.count" },
                value: String(item.quantity),
              },
            ],
          },
        ],
      });

  const initialAction: OndcIssueAction = {
    id: "A1",
    descriptor: { code: "OPEN", short_desc: "Complaint created" },
    updated_at: input.now,
    action_by: INTERFACING_NP_ACTOR_ID,
    actor_details: { name: input.billingName?.trim() || "Customer" },
  };

  return {
    context: {
      ...input.context,
      action: "issue",
      bpp_id: input.bppId,
      bpp_uri: input.bppUri,
      transaction_id: input.transactionId,
      message_id: input.messageId,
      timestamp: input.now,
      ttl: "PT30S",
    },
    message: {
      issue: {
        id: input.issueId,
        status: "OPEN",
        level: "ISSUE",
        created_at: input.now,
        updated_at: input.now,
        refs,
        actors,
        source_id: CONSUMER_ACTOR_ID,
        complainant_id: INTERFACING_NP_ACTOR_ID,
        descriptor: {
          code: category.descriptorCode,
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
          ...(input.images ? { images: input.images } : {}),
          ...(input.media ? { media: input.media } : {}),
        },
        last_action_id: "A1",
        actions: [initialAction],
      },
    },
  };
};

// ── UPDATE ───────────────────────────────────────────────────────────────────

export interface BuildIssueUpdatePayloadInput {
  existing: FullIssue;
  actionCode: IssueUpdateActionCode;
  resolutionId?: string;
  descriptorLongDesc?: string;
  images?: { url: string; size_type?: string }[];
  context: ContextBase;
  transactionId: string;
  messageId: string;
  now: string;
}

export interface BuildIssueUpdatePayloadResult {
  payload: OndcIssueRequest;
  nextStatus: string;
  nextLevel: string;
  newAction: IssueActionRow;
  nextLongDesc?: string;
}

const nextStatusForAction = (
  actionCode: IssueUpdateActionCode,
): "OPEN" | "PROCESSING" | "RESOLVED" | "CLOSED" => {
  switch (actionCode) {
    case "CLOSED":
      return "CLOSED";
    case "OPEN":
      return "OPEN";
    default:
      // RESOLUTION_ACCEPTED | RESOLUTION_REJECTED | INFO_PROVIDED | ESCALATED
      return "PROCESSING";
  }
};

export const buildIssueUpdatePayload = (
  input: BuildIssueUpdatePayloadInput,
): BuildIssueUpdatePayloadResult => {
  const { existing } = input;
  const nextStatus = nextStatusForAction(input.actionCode);
  const nextLevel: "ISSUE" | "GRIEVANCE" | "DISPUTE" =
    input.actionCode === "ESCALATED"
      ? "GRIEVANCE"
      : (existing.level as "ISSUE" | "GRIEVANCE" | "DISPUTE");
  const nextLongDesc =
    input.actionCode === "INFO_PROVIDED" && input.descriptorLongDesc !== undefined
      ? input.descriptorLongDesc
      : undefined;

  const newAction: IssueActionRow = {
    actionId: `A${existing.actions.length + 1}`,
    descriptorCode: input.actionCode,
    shortDesc: ACTION_SHORT_DESC[input.actionCode],
    updatedAt: input.now,
    actionBy: existing.complainantId || INTERFACING_NP_ACTOR_ID,
    ...(input.resolutionId ? { resolutionId: input.resolutionId } : {}),
  };

  const payload: OndcIssueRequest = {
    context: {
      ...input.context,
      action: "issue",
      bpp_id: existing.bppId ?? "",
      bpp_uri: existing.bppUri ?? "",
      transaction_id: input.transactionId,
      message_id: input.messageId,
      timestamp: input.now,
      ttl: "PT30S",
    },
    message: {
      issue: {
        id: existing.issueId,
        status: nextStatus,
        level: nextLevel,
        created_at: input.now,
        updated_at: input.now,
        refs: existing.refs.map(refToOndc),
        actors: existing.actors.map(actorToOndc),
        source_id: existing.sourceId || CONSUMER_ACTOR_ID,
        complainant_id: existing.complainantId || INTERFACING_NP_ACTOR_ID,
        descriptor: {
          code: existing.descriptorCode,
          ...(existing.shortDesc ? { short_desc: existing.shortDesc } : {}),
          long_desc: nextLongDesc ?? existing.longDesc ?? "",
          ...(existing.additionalDescUrl
            ? {
                additional_desc: {
                  url: existing.additionalDescUrl,
                  content_type: existing.additionalDescContentType,
                },
              }
            : {}),
          ...(input.images ? { images: input.images } : {}),
        },
        last_action_id: newAction.actionId,
        actions: [...existing.actions.map(actionRowToOndc), actionRowToOndc(newAction)],
      },
    },
  };

  return { payload, nextStatus, nextLevel, newAction, nextLongDesc };
};

// ── STATUS ───────────────────────────────────────────────────────────────────

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
  context: {
    ...input.context,
    action: "issue_status",
    bpp_id: input.bppId,
    bpp_uri: input.bppUri,
    transaction_id: input.transactionId,
    message_id: input.messageId,
    timestamp: input.now,
    ttl: "PT30S",
  },
  message: { issue_id: input.issueId },
});
