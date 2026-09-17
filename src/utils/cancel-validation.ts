import {
  getCancellationReason,
  isValidBnpCancellationReason,
} from "../constants/cancellation-reason-codes.js";
import type { CancelRequest } from "../types/cancel/internal.js";
import type {
  OndcCancelRequest,
  OndcOnCancelResponse,
} from "../types/cancel/ondc.js";

export class CancelValidationError extends Error {
  constructor(
    message: string,
    public readonly path?: string,
  ) {
    super(message);
    this.name = "CancelValidationError";
  }
}

const record = (v: unknown, p: string): Record<string, any> => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new CancelValidationError("must be an object", p);
  return v as Record<string, any>;
};
const str = (v: unknown, p: string) => {
  if (typeof v !== "string" || !v.trim())
    throw new CancelValidationError("must be a non-empty string", p);
  return v;
};

export const parseCancelRequest = (value: unknown): CancelRequest => {
  const x = record(value, "request body");
  const orderId = str(x.orderId, "orderId");
  const cancellationReasonId = str(x.cancellationReasonId, "cancellationReasonId");
  if (!isValidBnpCancellationReason(cancellationReasonId)) {
    const existing = getCancellationReason(cancellationReasonId);
    throw new CancelValidationError(
      existing
        ? `'${cancellationReasonId}' (${existing.reason}) is ${existing.whoCanUse}-only — not a reason this NP may send in /cancel`
        : `unknown cancellation_reason_id '${cancellationReasonId}'`,
      "cancellationReasonId",
    );
  }

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

  return { orderId, cancellationReasonId, ...(context ? { context } : {}) };
};

export const validateCancelPayload = (value: OndcCancelRequest): void => {
  if (value.context.action !== "cancel")
    throw new CancelValidationError("must be cancel", "context.action");
  str(value.message?.order_id, "message.order_id");
  str(value.message?.cancellation_reason_id, "message.cancellation_reason_id");
};

const context = (v: unknown): Record<string, any> => {
  const c = record(v, "context");
  if (c.action !== "on_cancel")
    throw new CancelValidationError("must be on_cancel", "context.action");
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
    throw new CancelValidationError("must be a valid timestamp", "context.timestamp");
  return c;
};

export const parseOnCancelResponse = (value: unknown): OndcOnCancelResponse => {
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
    return { ...x, error } as unknown as OndcOnCancelResponse;
  }

  // /on_cancel can be solicited (reply to our /cancel) or unsolicited (LSP
  // cancels directly), but either way it must carry an order with an id —
  // that's the correlation key for the unsolicited case.
  const m = record(x.message, "message");
  str(record(m.order, "message.order").id, "message.order.id");
  return value as OndcOnCancelResponse;
};
