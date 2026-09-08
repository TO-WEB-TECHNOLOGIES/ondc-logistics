import type { ConfirmRequest } from "../types/confirm/internal.js";
import type {
  OndcConfirmRequest,
  OndcOnConfirmResponse,
} from "../types/confirm/ondc.js";

export class ConfirmValidationError extends Error {
  constructor(
    message: string,
    public readonly path?: string,
  ) {
    super(message);
    this.name = "ConfirmValidationError";
  }
}

const record = (v: unknown, p: string): Record<string, any> => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new ConfirmValidationError("must be an object", p);
  return v as Record<string, any>;
};
const str = (v: unknown, p: string) => {
  if (typeof v !== "string" || !v.trim())
    throw new ConfirmValidationError("must be a non-empty string", p);
  return v;
};
const arr = (v: unknown, p: string) => {
  if (!Array.isArray(v))
    throw new ConfirmValidationError("must be an array", p);
  return v;
};
const address = (v: unknown, p: string) => {
  const x = record(v, p);
  str(x.area_code, `${p}.area_code`);
  return x;
};
const context = (v: unknown, action: "confirm" | "on_confirm") => {
  const c = record(v, "context");
  if (c.action !== action)
    throw new ConfirmValidationError(`must be ${action}`, "context.action");
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
  if (c.bpp_id !== undefined) str(c.bpp_id, "context.bpp_id");
  if (c.bpp_uri !== undefined) str(c.bpp_uri, "context.bpp_uri");
  if (Number.isNaN(new Date(c.timestamp).getTime()))
    throw new ConfirmValidationError(
      "must be a valid timestamp",
      "context.timestamp",
    );
  return c;
};
const validateBasicOrder = (v: unknown, p = "message.order") => {
  const o = record(v, p);
  str(o.id, p + ".id");
  str(o.state, p + ".state");
  str(o.created_at, p + ".created_at");
  str(o.updated_at, p + ".updated_at");
  const provider = record(o.provider, p + ".provider");
  str(provider.id, p + ".provider.id");
  // const locations = arr(provider.locations, p + ".provider.locations");
  // locations.forEach((x: any, i: number) =>
  //   str(
  //     record(x, p + ".provider.locations[" + i + "]").id,
  //     p + ".provider.locations[" + i + "].id",
  //   ),
  // );
  const items = arr(o.items, p + ".items");
  const fulfillments = arr(o.fulfillments, p + ".fulfillments");
  const fids = new Set(
    fulfillments.map((x: any, i: number) =>
      str(
        record(x, p + ".fulfillments[" + i + "]").id,
        p + ".fulfillments[" + i + "].id",
      ),
    ),
  );
  items.forEach((x: any, i: number) => {
    const z = record(x, p + ".items[" + i + "]");
    str(z.id, p + ".items[" + i + "].id");
    str(z.fulfillment_id, p + ".items[" + i + "].fulfillment_id");
    if (!fids.has(z.fulfillment_id))
      throw new ConfirmValidationError(
        "does not reference an order fulfillment",
        p + ".items[" + i + "].fulfillment_id",
      );
    str(z.category_id, p + ".items[" + i + "].category_id");
  });
  fulfillments.forEach((x: any, i: number) => {
    const z = record(x, p + ".fulfillments[" + i + "]");
    str(z.type, p + ".fulfillments[" + i + "].type");
  });
  const q = record(o.quote, p + ".quote");
  const price = record(q.price, p + ".quote.price");
  str(price.currency, p + ".quote.price.currency");
  str(price.value, p + ".quote.price.value");
  arr(q.breakup, p + ".quote.breakup");
  const payment = record(o.payment, p + ".payment");
  str(payment.type, p + ".payment.type");
  str(payment.collected_by, p + ".payment.collected_by");
  if (
    payment["@ondc/org/collection_amount"] === undefined &&
    payment.paid_amount === undefined
  )
    throw new ConfirmValidationError(
      "payment amount is required",
      p + ".payment",
    );
  return o;
};
const validateWorkbenchFields = (o: any, p: string) => {
  const categories = [
    "Express Delivery",
    "Standard Delivery",
    "Immediate Delivery",
    "Next Day Delivery",
    "Same Day Delivery",
    "Instant Delivery",
  ];
  o.items.forEach((item: any, i: number) => {
    if (!categories.includes(item.category_id))
      throw new ConfirmValidationError(
        "must be a valid ONDC delivery category",
        p + ".items[" + i + "].category_id",
      );
  });
};
const requireAcceptance = (order: any) => {
  const tags = Array.isArray(order.tags) ? order.tags : [];
  const bap = tags.find((x: any) => x?.code === "bap_terms");
  if (
    !bap?.list?.some(
      (x: any) => x?.code === "accept_bpp_terms" && x?.value === "Y",
    )
  )
    throw new ConfirmValidationError(
      "bap_terms.accept_bpp_terms=Y is required",
      "message.order.tags",
    );
};
export const parseConfirmRequest = (value: unknown): ConfirmRequest => {
  const x = record(value, "request body");
  const result: ConfirmRequest = {
    initTransactionId: str(x.initTransactionId, "initTransactionId"),
  };

  if (x.context !== undefined) {
    const c = record(x.context, "context");
    if (c.action !== undefined && c.action !== "confirm")
      throw new ConfirmValidationError("must be confirm", "context.action");
    result.context = {
      ...(c.transaction_id !== undefined
        ? { transaction_id: str(c.transaction_id, "context.transaction_id") }
        : {}),
      ...(c.message_id !== undefined
        ? { message_id: str(c.message_id, "context.message_id") }
        : {}),
    };
  }
  if (x.message !== undefined) {
    const m = record(x.message, "message");
    if (m.order !== undefined)
      result.message = { order: record(m.order, "message.order") };
  }
  if (x.order !== undefined) result.order = record(x.order, "order");

  return result;
};
export const validateConfirmPayload = (value: OndcConfirmRequest): void => {
  if (value.context.action !== "confirm")
    throw new ConfirmValidationError("must be confirm", "context.action");
  validateBasicOrder(value.message.order);
  validateWorkbenchFields(value.message.order, "message.order");
  requireAcceptance(value.message.order);
};
export const parseOnConfirmResponse = (
  value: unknown,
): OndcOnConfirmResponse => {
  const x = record(value, "callback body");
  context(x.context, "on_confirm");

  if (x.error !== undefined) {
    const e = record(x.error, "error");
    str(e.code, "error.code");
    str(e.message, "error.message");

    // ONDC's error schema does not allow gateway diagnostics such as
    // `tags` or `paths`. Keep only the protocol fields before persisting or
    // passing the callback further into the application.
    const error = {
      ...(e.type !== undefined ? { type: e.type } : {}),
      code: e.code,
      message: e.message,
    };
    return { ...x, error } as unknown as OndcOnConfirmResponse;
  }

  const m = record(x.message, "message");
  validateBasicOrder(m.order);
  validateWorkbenchFields(m.order, "message.order");
  return value as OndcOnConfirmResponse;
};
