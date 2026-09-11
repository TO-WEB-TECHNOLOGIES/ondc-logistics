import type { StatusRequest } from "../types/status/internal.js";
import type {
  OndcOnStatusResponse,
  OndcStatusRequest,
} from "../types/status/ondc.js";

export class StatusValidationError extends Error {
  constructor(
    message: string,
    public readonly path?: string,
  ) {
    super(message);
    this.name = "StatusValidationError";
  }
}

const record = (v: unknown, p: string): Record<string, any> => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new StatusValidationError("must be an object", p);
  return v as Record<string, any>;
};
const str = (v: unknown, p: string) => {
  if (typeof v !== "string" || !v.trim())
    throw new StatusValidationError("must be a non-empty string", p);
  return v;
};

export const parseStatusRequest = (value: unknown): StatusRequest => {
  const x = record(value, "request body");
  const orderId = str(x.orderId, "orderId");

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

  return { orderId, ...(context ? { context } : {}) };
};

export const validateStatusPayload = (value: OndcStatusRequest): void => {
  if (value.context.action !== "status")
    throw new StatusValidationError("must be status", "context.action");
  str(value.message?.order_id, "message.order_id");
};

const context = (v: unknown): Record<string, any> => {
  const c = record(v, "context");
  if (c.action !== "on_status")
    throw new StatusValidationError("must be on_status", "context.action");
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
    throw new StatusValidationError("must be a valid timestamp", "context.timestamp");
  return c;
};

export const parseOnStatusResponse = (value: unknown): OndcOnStatusResponse => {
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
    return { ...x, error } as unknown as OndcOnStatusResponse;
  }

  // /on_status can be solicited or unsolicited, but either way it must
  // carry an order with an id — that's the only correlation key we have.
  const m = record(x.message, "message");
  str(record(m.order, "message.order").id, "message.order.id");
  return value as OndcOnStatusResponse;
};
