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

/**
 * The real IGM 2.0 shape actually sent by workbench.ondc.tech (confirmed
 * against live /on_issue and /on_issue_status payloads) — NOT the flat
 * `actions[]` shape in src/json/on_issue.json. Each entry embeds the acting
 * party's contact info directly (`updated_by`) rather than referencing a
 * shared `actors[]` list, and there is no explicit per-action `id`.
 */
export interface OndcIssueActionUpdatedBy {
  org?: { name?: string };
  person?: { name?: string };
  contact?: { phone?: string; email?: string };
}
export interface OndcIssueActionEntry {
  cascaded_level?: number;
  complainant_action?: string;
  respondent_action?: string;
  short_desc?: string;
  updated_at: string;
  updated_by?: OndcIssueActionUpdatedBy;
}
export interface OndcIssueActions {
  complainant_actions?: OndcIssueActionEntry[];
  respondent_actions?: OndcIssueActionEntry[];
}

/** Also observed live — resolution terms once the BPP proposes/executes one. */
export interface OndcIssueResolution {
  action_triggered?: string;
  short_desc?: string;
  long_desc?: string;
  refund_amount?: string;
}
/** Observed live but not deeply modeled/persisted yet — kept loose. */
export interface OndcIssueResolutionProvider {
  respondent_info?: {
    organization?: unknown;
    resolution_support?: unknown;
    type?: string;
  };
}

export interface OndcIssueObject {
  id: string;
  // Present on the flat/older sample shape (src/json/*.json); ABSENT on the
  // real IGM 2.0 payloads observed from workbench.ondc.tech, which instead
  // carry `issue_actions`/`resolution` below. Both shapes are tolerated.
  status?: "OPEN" | "PROCESSING" | "RESOLVED" | "CLOSED";
  level?: "ISSUE" | "GRIEVANCE" | "DISPUTE";
  created_at: string;
  updated_at: string;
  expected_response_time?: { duration: string };
  expected_resolution_time?: { duration: string };
  refs?: OndcIssueRef[];
  actors?: OndcIssueActor[];
  source_id?: string;
  complainant_id?: string;
  respondent_ids?: string[];
  descriptor?: OndcIssueDescriptor;
  last_action_id?: string;
  actions?: OndcIssueAction[];
  issue_actions?: OndcIssueActions;
  resolution?: OndcIssueResolution;
  resolution_provider?: OndcIssueResolutionProvider;
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
    "core_version",
    "bap_id",
    "bap_uri",
    "transaction_id",
    "message_id",
    "timestamp",
  ])
    str(c[k], `context.${k}`);
  // Real /on_issue|/on_issue_status callbacks from workbench.ondc.tech omit
  // `city` entirely (confirmed from live traffic) — unlike /init|/on_init,
  // where it's always present. Validate it only when supplied.
  if (c.city !== undefined) str(c.city, "context.city");
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

// Only `id`/`created_at`/`updated_at` are unconditionally required — the rest
// depends on which of the two observed shapes this callback carries (see
// OndcIssueObject's comment): the old flat shape (status/level/refs/actors/
// descriptor/actions), the real IGM 2.0 shape (issue_actions), or a partial
// update that legitimately omits both (e.g. just a resolution/resolution_provider
// patch). At least one of {actions, issue_actions, resolution} must be present
// so an empty/no-op callback still gets rejected.
const issueObject = (v: unknown, p = "message.issue"): OndcIssueObject => {
  const o = record(v, p);
  str(o.id, `${p}.id`);
  str(o.created_at, `${p}.created_at`);
  str(o.updated_at, `${p}.updated_at`);

  if (o.refs !== undefined)
    arr(o.refs, `${p}.refs`).forEach((r, i) => {
      const x = record(r, `${p}.refs[${i}]`);
      str(x.ref_id, `${p}.refs[${i}].ref_id`);
      str(x.ref_type, `${p}.refs[${i}].ref_type`);
    });
  if (o.actors !== undefined)
    arr(o.actors, `${p}.actors`).forEach((a, i) => {
      const x = record(a, `${p}.actors[${i}]`);
      str(x.id, `${p}.actors[${i}].id`);
      str(x.type, `${p}.actors[${i}].type`);
    });
  if (o.descriptor !== undefined)
    str(record(o.descriptor, `${p}.descriptor`).code, `${p}.descriptor.code`);
  if (o.actions !== undefined)
    arr(o.actions, `${p}.actions`).forEach((a, i) => {
      const x = record(a, `${p}.actions[${i}]`);
      str(x.id, `${p}.actions[${i}].id`);
      const d = record(x.descriptor, `${p}.actions[${i}].descriptor`);
      str(d.code, `${p}.actions[${i}].descriptor.code`);
      str(x.updated_at, `${p}.actions[${i}].updated_at`);
      str(x.action_by, `${p}.actions[${i}].action_by`);
    });

  const issueActionEntry = (e: unknown, entryPath: string) => {
    const x = record(e, entryPath);
    str(x.updated_at, `${entryPath}.updated_at`);
    if (x.complainant_action === undefined && x.respondent_action === undefined)
      throw new IssueValidationError(
        "must have complainant_action or respondent_action",
        entryPath,
      );
  };
  if (o.issue_actions !== undefined) {
    const ia = record(o.issue_actions, `${p}.issue_actions`);
    if (ia.complainant_actions !== undefined)
      arr(ia.complainant_actions, `${p}.issue_actions.complainant_actions`).forEach(
        (e, i) => issueActionEntry(e, `${p}.issue_actions.complainant_actions[${i}]`),
      );
    if (ia.respondent_actions !== undefined)
      arr(ia.respondent_actions, `${p}.issue_actions.respondent_actions`).forEach(
        (e, i) => issueActionEntry(e, `${p}.issue_actions.respondent_actions[${i}]`),
      );
  }
  if (o.resolution !== undefined) record(o.resolution, `${p}.resolution`);

  if (
    o.actions === undefined &&
    o.issue_actions === undefined &&
    o.resolution === undefined
  )
    throw new IssueValidationError(
      "must carry actions, issue_actions, or resolution",
      p,
    );

  return o as OndcIssueObject;
};

/**
 * workbench.ondc.tech has been observed sending /on_issue_status as a
 * top-level JSON array containing a single callback object, instead of the
 * bare object every other ONDC callback in this codebase uses. Tolerate
 * both: an array is split into its individual callback items.
 */
export const toCallbackItems = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [value];

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
