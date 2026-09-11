import type {
  AuthenticationUpdateRequest,
  InstructionUpdateRequest,
  LinkedOrderDetailsUpdateRequest,
  ReadyToShipUpdateRequest,
  UpdateRequest,
  UpdateType,
} from "../types/update/internal.js";
import type {
  OndcOnUpdateResponse,
  OndcUpdateRequest,
} from "../types/update/ondc.js";

export class UpdateValidationError extends Error {
  constructor(
    message: string,
    public readonly path?: string,
  ) {
    super(message);
    this.name = "UpdateValidationError";
  }
}

const record = (v: unknown, p: string): Record<string, any> => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new UpdateValidationError("must be an object", p);
  return v as Record<string, any>;
};
const str = (v: unknown, p: string) => {
  if (typeof v !== "string" || !v.trim())
    throw new UpdateValidationError("must be a non-empty string", p);
  return v;
};
const optStr = (v: unknown, p: string) => {
  if (v === undefined) return undefined;
  return str(v, p);
};
const strArr = (v: unknown, p: string) => {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string"))
    throw new UpdateValidationError("must be an array of strings", p);
  return v as string[];
};

const UPDATE_TYPES: UpdateType[] = [
  "LINKED_ORDER_DETAILS",
  "START_INSTRUCTION",
  "END_INSTRUCTION",
  "START_AUTHENTICATION",
  "END_AUTHENTICATION",
  "READY_TO_SHIP",
];

// ─── Per-type payload checkers ─────────────────────────────────────────────

const checkLinkedOrderDetails = (
  x: Record<string, any>,
): LinkedOrderDetailsUpdateRequest["linkedOrder"] => {
  const l = record(x.linkedOrder, "linkedOrder");
  const weight = l.weight !== undefined ? record(l.weight, "linkedOrder.weight") : undefined;
  const dimensions =
    l.dimensions !== undefined ? record(l.dimensions, "linkedOrder.dimensions") : undefined;
  const dim = (key: string) =>
    dimensions?.[key] !== undefined
      ? record(dimensions[key], `linkedOrder.dimensions.${key}`)
      : undefined;
  if (
    l.retailOrderId === undefined &&
    l.productName === undefined &&
    l.quantityCount === undefined &&
    !weight &&
    !dimensions &&
    l.providerName === undefined
  )
    throw new UpdateValidationError(
      "must supply at least one linked-order field to update",
      "linkedOrder",
    );
  return {
    retailOrderId: optStr(l.retailOrderId, "linkedOrder.retailOrderId"),
    productName: optStr(l.productName, "linkedOrder.productName"),
    quantityCount: l.quantityCount,
    weight: weight
      ? { unit: str(weight.unit, "linkedOrder.weight.unit"), value: weight.value }
      : undefined,
    dimensions: dimensions
      ? (() => {
          const length = dim("length");
          const breadth = dim("breadth");
          const height = dim("height");
          return {
            length: length
              ? { unit: str(length.unit, "linkedOrder.dimensions.length.unit"), value: length.value }
              : undefined,
            breadth: breadth
              ? { unit: str(breadth.unit, "linkedOrder.dimensions.breadth.unit"), value: breadth.value }
              : undefined,
            height: height
              ? { unit: str(height.unit, "linkedOrder.dimensions.height.unit"), value: height.value }
              : undefined,
          };
        })()
      : undefined,
    providerName: optStr(l.providerName, "linkedOrder.providerName"),
  };
};

const checkInstruction = (
  x: Record<string, any>,
): InstructionUpdateRequest["instruction"] => {
  const i = record(x.instruction, "instruction");
  return {
    code: str(i.code, "instruction.code"),
    shortDesc: optStr(i.shortDesc, "instruction.shortDesc"),
    longDesc: optStr(i.longDesc, "instruction.longDesc"),
    images: strArr(i.images, "instruction.images"),
  };
};

const checkAuthentication = (
  x: Record<string, any>,
): AuthenticationUpdateRequest["authorization"] => {
  const a = record(x.authorization, "authorization");
  return {
    type: optStr(a.type, "authorization.type"),
    token: str(a.token, "authorization.token"),
    validFrom: optStr(a.validFrom, "authorization.validFrom"),
    validTo: optStr(a.validTo, "authorization.validTo"),
  };
};

// ─── Request parsing ────────────────────────────────────────────────────────

export const parseUpdateRequest = (value: unknown): UpdateRequest => {
  const x = record(value, "request body");
  const orderId = str(x.orderId, "orderId");
  const fulfillmentId = str(x.fulfillmentId, "fulfillmentId");
  const updateType = str(x.updateType, "updateType") as UpdateType;
  if (!UPDATE_TYPES.includes(updateType))
    throw new UpdateValidationError(
      `must be one of ${UPDATE_TYPES.join(", ")}`,
      "updateType",
    );

  const context =
    x.context !== undefined
      ? (() => {
          const c = record(x.context, "context");
          return {
            ...(c.transaction_id !== undefined
              ? { transaction_id: str(c.transaction_id, "context.transaction_id") }
              : {}),
            ...(c.message_id !== undefined
              ? { message_id: str(c.message_id, "context.message_id") }
              : {}),
          };
        })()
      : undefined;

  const base = { orderId, fulfillmentId, ...(context ? { context } : {}) };

  switch (updateType) {
    case "LINKED_ORDER_DETAILS":
      return { ...base, updateType, linkedOrder: checkLinkedOrderDetails(x) };
    case "START_INSTRUCTION":
    case "END_INSTRUCTION":
      return { ...base, updateType, instruction: checkInstruction(x) };
    case "START_AUTHENTICATION":
    case "END_AUTHENTICATION":
      return { ...base, updateType, authorization: checkAuthentication(x) };
    case "READY_TO_SHIP":
      return { ...base, updateType } satisfies ReadyToShipUpdateRequest;
  }
};

// ─── Outbound wire-payload checker ─────────────────────────────────────────

export const validateUpdatePayload = (value: OndcUpdateRequest): void => {
  if (value.context.action !== "update")
    throw new UpdateValidationError("must be update", "context.action");
  if (value.message.update_target !== "fulfillment")
    throw new UpdateValidationError(
      "must be fulfillment",
      "message.update_target",
    );
  const order = record(value.message.order, "message.order");
  str(order.id, "message.order.id");
  if (!Array.isArray(order.items) || order.items.length === 0)
    throw new UpdateValidationError("must be a non-empty array", "message.order.items");
  order.items.forEach((item: any, i: number) => {
    str(record(item, `message.order.items[${i}]`).id, `message.order.items[${i}].id`);
  });
  if (!Array.isArray(order.fulfillments) || order.fulfillments.length === 0)
    throw new UpdateValidationError(
      "must be a non-empty array",
      "message.order.fulfillments",
    );
  order.fulfillments.forEach((f: any, i: number) => {
    str(
      record(f, `message.order.fulfillments[${i}]`).id,
      `message.order.fulfillments[${i}].id`,
    );
  });
};

// ─── Inbound /on_update checker ────────────────────────────────────────────

const context = (v: unknown): Record<string, any> => {
  const c = record(v, "context");
  if (c.action !== "on_update")
    throw new UpdateValidationError("must be on_update", "context.action");
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
    throw new UpdateValidationError("must be a valid timestamp", "context.timestamp");
  return c;
};

export const parseOnUpdateResponse = (value: unknown): OndcOnUpdateResponse => {
  const x = record(value, "callback body");
  context(x.context);

  if (x.error !== undefined) {
    const e = record(x.error, "error");
    str(e.code, "error.code");
    str(e.message, "error.message");
    const error = {
      ...(e.type !== undefined ? { type: e.type } : {}),
      code: e.code,
      message: e.message,
    };
    return { ...x, error } as unknown as OndcOnUpdateResponse;
  }

  if (x.message !== undefined) {
    const m = record(x.message, "message");
    if (m.order !== undefined) str(record(m.order, "message.order").id, "message.order.id");
  }
  return value as OndcOnUpdateResponse;
};
