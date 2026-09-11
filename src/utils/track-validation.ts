import type { TrackRequest } from "../types/track/internal.js";
import type { OndcOnTrackResponse, OndcTrackRequest } from "../types/track/ondc.js";

export class TrackValidationError extends Error {
  constructor(
    message: string,
    public readonly path?: string,
  ) {
    super(message);
    this.name = "TrackValidationError";
  }
}

const record = (v: unknown, p: string): Record<string, any> => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new TrackValidationError("must be an object", p);
  return v as Record<string, any>;
};
const str = (v: unknown, p: string) => {
  if (typeof v !== "string" || !v.trim())
    throw new TrackValidationError("must be a non-empty string", p);
  return v;
};

export const parseTrackRequest = (value: unknown): TrackRequest => {
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

export const validateTrackPayload = (value: OndcTrackRequest): void => {
  if (value.context.action !== "track")
    throw new TrackValidationError("must be track", "context.action");
  str(value.message?.order_id, "message.order_id");
};

const context = (v: unknown): Record<string, any> => {
  const c = record(v, "context");
  if (c.action !== "on_track")
    throw new TrackValidationError("must be on_track", "context.action");
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
    throw new TrackValidationError("must be a valid timestamp", "context.timestamp");
  return c;
};

export const parseOnTrackResponse = (value: unknown): OndcOnTrackResponse => {
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
    return { ...x, error } as unknown as OndcOnTrackResponse;
  }

  const m = record(x.message, "message");
  record(m.tracking, "message.tracking");
  return value as OndcOnTrackResponse;
};
