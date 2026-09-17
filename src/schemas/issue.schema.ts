/**
 * ONDC IGM (Issue & Grievance) — wire types, internal types, and validators
 * for /issue, /on_issue, /issue_status, /on_issue_status.
 *
 * Contract source: docs/ondc/ondc logistics.docx has no IGM section (only two
 * unrelated mentions of "IGM" in the changelog). Wire shapes here are taken
 * from src/json/{issue,on_issue,issue_status,on_issue_status}.json — see
 * CLAUDE.md's "contract is the source of truth" rule; this is the closest
 * available source of truth for this endpoint family.
 */
import { ISSUE_CATEGORIES, type IssueCategoryCode } from "../constants/issueCategories.js";
import type { OndcContext } from "../types/search/ondc.js";

export class IssueValidationError extends Error {
  constructor(
    message: string,
    public readonly path?: string,
  ) {
    super(message);
    this.name = "IssueValidationError";
  }
}

// ── ONDC wire types ─────────────────────────────────────────────────────────

export interface OndcIssueActorInfo {
  org?: { name?: string };
  person?: { name?: string };
  contact?: { phone?: string; email?: string };
}

export interface OndcIssueActor {
  id: string;
  type: string;
  info?: OndcIssueActorInfo;
}

export interface OndcIssueRefTag {
  descriptor: { code: string };
  list: { descriptor: { code: string }; value: string }[];
}

export interface OndcIssueRef {
  ref_id: string;
  ref_type: "ORDER" | "PROVIDER" | "FULFILLMENT" | "ITEM" | "RESOLUTIONS";
  tags?: OndcIssueRefTag[];
}

export interface OndcIssueAction {
  id: string;
  descriptor: { code: string; name?: string; short_desc?: string };
  updated_at: string;
  action_by: string;
  actor_details?: { name?: string };
}

export interface OndcIssueDescriptor {
  code: string;
  short_desc?: string;
  long_desc: string;
  additional_desc?: { url: string; content_type?: string };
  images?: { url: string; size_type?: string }[];
  media?: { url: string }[];
}

export interface OndcIssueObject {
  id: string;
  status: "OPEN" | "PROCESSING" | "RESOLVED" | "CLOSED";
  level: "ISSUE" | "GRIEVANCE" | "DISPUTE";
  created_at: string;
  updated_at: string;
  expected_response_time?: { duration: string };
  expected_resolution_time?: { duration: string };
  refs: OndcIssueRef[];
  actors: OndcIssueActor[];
  source_id: string;
  complainant_id: string;
  respondent_ids?: string[];
  descriptor: OndcIssueDescriptor;
  last_action_id: string;
  actions: OndcIssueAction[];
}

export interface OndcIssueRequest {
  context: OndcContext & { action: "issue"; bpp_id: string; bpp_uri: string };
  message: { issue: OndcIssueObject };
}

export interface OndcOnIssueResponse {
  context: OndcContext & { action: "on_issue"; transaction_id: string };
  message?: {
    update_target?: { path: string; action: string }[];
    issue: OndcIssueObject;
  };
  error?: { code: string; message?: string };
}

export interface OndcIssueStatusRequest {
  context: OndcContext & {
    action: "issue_status";
    bpp_id: string;
    bpp_uri: string;
  };
  message: { issue_id: string };
}

export interface OndcOnIssueStatusResponse {
  context: OndcContext & { action: "on_issue_status"; transaction_id: string };
  message?: {
    update_target?: { path: string; action: string }[];
    issue: OndcIssueObject;
  };
  error?: { code: string; message?: string };
}

// ── Internal request types (BFF-facing) ─────────────────────────────────────

export interface CreateIssueInput {
  orderId: string;
  categoryCode: IssueCategoryCode;
  descriptorLongDesc: string;
  descriptorAdditionalDescUrl?: string;
  images?: { url: string; size_type?: string }[];
  media?: { url: string }[];
  items: { id: string; quantity: number }[];
  context?: { transaction_id?: string; message_id?: string };
}

export const ISSUE_UPDATE_ACTIONS = [
  "RESOLUTION_ACCEPTED",
  "RESOLUTION_REJECTED",
  "INFO_PROVIDED",
  "CLOSED",
  "OPEN",
  "ESCALATED",
] as const;
export type IssueUpdateActionCode = (typeof ISSUE_UPDATE_ACTIONS)[number];

export interface UpdateIssueInput {
  issueId: string;
  actionCode: IssueUpdateActionCode;
  resolutionId?: string;
  descriptorLongDesc?: string;
  images?: { url: string; size_type?: string }[];
  context?: { transaction_id?: string; message_id?: string };
}

export interface CheckIssueStatusInput {
  issueId: string;
  context?: { transaction_id?: string; message_id?: string };
}

// ── Validation helpers (same hand-rolled style as utils/init-validation.ts —
// no schema-validation library in this repo) ────────────────────────────────

const record = (v: unknown, p: string): Record<string, any> => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new IssueValidationError("must be an object", p);
  return v as Record<string, any>;
};
const str = (v: unknown, p: string): string => {
  if (typeof v !== "string" || !v.trim())
    throw new IssueValidationError("must be a non-empty string", p);
  return v;
};
const arr = (v: unknown, p: string): unknown[] => {
  if (!Array.isArray(v)) throw new IssueValidationError("must be an array", p);
  return v;
};

const context = (v: unknown, action: string) => {
  const c = record(v, "context");
  if (c.action !== action)
    throw new IssueValidationError(`must be ${action}`, "context.action");
  for (const k of [
    "domain",
    "country",
    "city",
    "core_version",
    "bap_id",
    "bap_uri",
    "transaction_id",
    "message_id",
    "timestamp",
  ])
    str(c[k], `context.${k}`);
  if (Number.isNaN(new Date(c.timestamp).getTime()))
    throw new IssueValidationError(
      "must be a valid timestamp",
      "context.timestamp",
    );
  return c;
};

const parseOptionalContextOverride = (v: unknown) => {
  if (v === undefined) return undefined;
  const c = record(v, "context");
  return {
    ...(c.transaction_id !== undefined
      ? { transaction_id: str(c.transaction_id, "context.transaction_id") }
      : {}),
    ...(c.message_id !== undefined
      ? { message_id: str(c.message_id, "context.message_id") }
      : {}),
  };
};

const parseImages = (v: unknown, p: string) => {
  if (v === undefined) return undefined;
  return arr(v, p).map((im, i) => {
    const o = record(im, `${p}[${i}]`);
    str(o.url, `${p}[${i}].url`);
    return { url: o.url as string, ...(o.size_type ? { size_type: o.size_type } : {}) };
  });
};

const parseMedia = (v: unknown, p: string) => {
  if (v === undefined) return undefined;
  return arr(v, p).map((m, i) => {
    const o = record(m, `${p}[${i}]`);
    str(o.url, `${p}[${i}].url`);
    return { url: o.url as string };
  });
};

export const parseCreateIssueRequest = (value: unknown): CreateIssueInput => {
  const x = record(value, "request body");
  const orderId = str(x.order_id, "order_id");
  const categoryCode = str(x.category_code, "category_code") as IssueCategoryCode;
  const category = ISSUE_CATEGORIES[categoryCode];
  if (!category)
    throw new IssueValidationError(
      `unknown category_code '${categoryCode}'`,
      "category_code",
    );
  const descriptorLongDesc = str(x.descriptor_long_desc, "descriptor_long_desc");

  const itemsArr = arr(x.items, "items");
  if (itemsArr.length === 0)
    throw new IssueValidationError("must have at least one item", "items");
  const items = itemsArr.map((it, i) => {
    const o = record(it, `items[${i}]`);
    const id = str(o.id, `items[${i}].id`);
    if (!Number.isInteger(o.quantity) || o.quantity < 1)
      throw new IssueValidationError(
        "must be an integer >= 1",
        `items[${i}].quantity`,
      );
    return { id, quantity: o.quantity as number };
  });

  const images = parseImages(x.images, "images");
  if (category.requiresImages && (!images || images.length === 0))
    throw new IssueValidationError(
      `images are required for category '${categoryCode}' (${category.shortDesc})`,
      "images",
    );
  const media = parseMedia(x.media, "media");

  return {
    orderId,
    categoryCode,
    descriptorLongDesc,
    ...(x.descriptor_additional_desc_url !== undefined
      ? {
          descriptorAdditionalDescUrl: str(
            x.descriptor_additional_desc_url,
            "descriptor_additional_desc_url",
          ),
        }
      : {}),
    ...(images ? { images } : {}),
    ...(media ? { media } : {}),
    items,
    ...(x.context !== undefined
      ? { context: parseOptionalContextOverride(x.context) }
      : {}),
  };
};

export const parseUpdateIssueRequest = (value: unknown): UpdateIssueInput => {
  const x = record(value, "request body");
  const issueId = str(x.issue_id, "issue_id");
  const actionCode = str(x.action_code, "action_code") as IssueUpdateActionCode;
  if (!ISSUE_UPDATE_ACTIONS.includes(actionCode))
    throw new IssueValidationError(
      `must be one of: ${ISSUE_UPDATE_ACTIONS.join(", ")}`,
      "action_code",
    );
  if (
    (actionCode === "RESOLUTION_ACCEPTED" || actionCode === "RESOLUTION_REJECTED") &&
    !x.resolution_id
  )
    throw new IssueValidationError(
      `resolution_id is required for ${actionCode}`,
      "resolution_id",
    );

  const images = parseImages(x.images, "images");

  return {
    issueId,
    actionCode,
    ...(x.resolution_id !== undefined
      ? { resolutionId: str(x.resolution_id, "resolution_id") }
      : {}),
    ...(x.descriptor_long_desc !== undefined
      ? { descriptorLongDesc: str(x.descriptor_long_desc, "descriptor_long_desc") }
      : {}),
    ...(images ? { images } : {}),
    ...(x.context !== undefined
      ? { context: parseOptionalContextOverride(x.context) }
      : {}),
  };
};

export const parseCheckIssueStatusRequest = (
  value: unknown,
): CheckIssueStatusInput => {
  const x = record(value, "request body");
  const issueId = str(x.issue_id, "issue_id");
  return {
    issueId,
    ...(x.context !== undefined
      ? { context: parseOptionalContextOverride(x.context) }
      : {}),
  };
};

const issueObject = (v: unknown, p = "message.issue"): OndcIssueObject => {
  const o = record(v, p);
  str(o.id, `${p}.id`);
  str(o.status, `${p}.status`);
  str(o.level, `${p}.level`);
  const refs = arr(o.refs, `${p}.refs`);
  refs.forEach((r, i) => {
    const x = record(r, `${p}.refs[${i}]`);
    str(x.ref_id, `${p}.refs[${i}].ref_id`);
    str(x.ref_type, `${p}.refs[${i}].ref_type`);
  });
  const actors = arr(o.actors, `${p}.actors`);
  actors.forEach((a, i) => {
    const x = record(a, `${p}.actors[${i}]`);
    str(x.id, `${p}.actors[${i}].id`);
    str(x.type, `${p}.actors[${i}].type`);
  });
  const descriptor = record(o.descriptor, `${p}.descriptor`);
  str(descriptor.code, `${p}.descriptor.code`);
  const actions = arr(o.actions, `${p}.actions`);
  actions.forEach((a, i) => {
    const x = record(a, `${p}.actions[${i}]`);
    str(x.id, `${p}.actions[${i}].id`);
    const d = record(x.descriptor, `${p}.actions[${i}].descriptor`);
    str(d.code, `${p}.actions[${i}].descriptor.code`);
    str(x.updated_at, `${p}.actions[${i}].updated_at`);
    str(x.action_by, `${p}.actions[${i}].action_by`);
  });
  return o as OndcIssueObject;
};

export const parseOnIssueResponse = (value: unknown): OndcOnIssueResponse => {
  const x = record(value, "callback body");
  context(x.context, "on_issue");
  if (x.error !== undefined) {
    const e = record(x.error, "error");
    str(e.code, "error.code");
    return value as OndcOnIssueResponse;
  }
  const m = record(x.message, "message");
  issueObject(m.issue);
  return value as OndcOnIssueResponse;
};

export const parseOnIssueStatusResponse = (
  value: unknown,
): OndcOnIssueStatusResponse => {
  const x = record(value, "callback body");
  context(x.context, "on_issue_status");
  if (x.error !== undefined) {
    const e = record(x.error, "error");
    str(e.code, "error.code");
    return value as OndcOnIssueStatusResponse;
  }
  const m = record(x.message, "message");
  issueObject(m.issue);
  return value as OndcOnIssueStatusResponse;
};
