import type { InitRequest } from "../types/init/internal.js";
import type {
  OndcInitRequest,
  OndcOnInitResponse,
} from "../types/init/ondc.js";
export class InitValidationError extends Error {
  constructor(
    message: string,
    public readonly path?: string,
  ) {
    super(message);
    this.name = "InitValidationError";
  }
}
const PAYMENT_TYPES = ["ON-ORDER", "ON-FULFILLMENT", "POST-FULFILLMENT"];
// This LBNP never offers CoD (ON-FULFILLMENT); prepaid types only.
const ALLOWED_INIT_PAYMENT_TYPES = ["ON-ORDER", "POST-FULFILLMENT"];
const SETTLEMENT_TYPES = ["upi", "neft", "rtgs"];
const record = (v: unknown, p: string): Record<string, any> => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new InitValidationError("must be an object", p);
  return v as Record<string, any>;
};
const str = (v: unknown, p: string) => {
  if (typeof v !== "string" || !v.trim())
    throw new InitValidationError("must be a non-empty string", p);
  return v;
};
const arr = (v: unknown, p: string) => {
  if (!Array.isArray(v)) throw new InitValidationError("must be an array", p);
  return v;
};
const address = (v: unknown, p: string) => {
  const x = record(v, p);
  str(x.area_code, `${p}.area_code`);
  return x;
};
const context = (v: unknown, action: "init" | "on_init") => {
  const c = record(v, "context");
  if (c.action !== action)
    throw new InitValidationError(`must be ${action}`, "context.action");
  for (const k of [
    "domain",
    "country",
    "city",
    "core_version",
    "bap_uri",
    "transaction_id",
    "message_id",
    "timestamp",
  ])
    str(c[k], `context.${k}`);
  if (action === "init") {
    str(c.bap_id, "context.bap_id");
    str(c.bpp_id, "context.bpp_id");
    str(c.bpp_uri, "context.bpp_uri");
  }
  if (c.ttl !== undefined) str(c.ttl, "context.ttl");
  if (Number.isNaN(new Date(c.timestamp).getTime()))
    throw new InitValidationError(
      "must be a valid timestamp",
      "context.timestamp",
    );
  return c;
};
const contact = (v: unknown, p: string) => {
  const x = record(v, p);
  if (x.phone === undefined && x.email === undefined)
    throw new InitValidationError("phone or email is required", p);
  if (x.phone !== undefined) str(x.phone, `${p}.phone`);
  if (x.email !== undefined) str(x.email, `${p}.email`);
  return x;
};
const fulfillment = (v: unknown, p: string) => {
  const x = record(v, p);
  str(x.id, `${p}.id`);
  str(x.type, `${p}.type`);
  for (const side of ["start", "end"]) {
    const z = record(x[side], `${p}.${side}`);
    const loc = record(z.location, `${p}.${side}.location`);
    str(loc.gps, `${p}.${side}.location.gps`);
    address(loc.address, `${p}.${side}.location.address`);
    contact(z.contact, `${p}.${side}.contact`);
  }
  return x;
};
const order = (v: unknown, p = "message.order", requireBilling = true) => {
  const o = record(v, p);
  const provider = record(o.provider, `${p}.provider`);
  str(provider.id, `${p}.provider.id`);
  if (provider.locations !== undefined) {
    const locations = arr(provider.locations, `${p}.provider.locations`);
    locations.forEach((l, i) =>
      str(
        record(l, `${p}.provider.locations[${i}]`).id,
        `${p}.provider.locations[${i}].id`,
      ),
    );
  }
  const items = arr(o.items, `${p}.items`);
  items.forEach((i, n) => {
    const x = record(i, `${p}.items[${n}]`);
    str(x.id, `${p}.items[${n}].id`);
    if (x.fulfillment_id !== undefined)
      str(x.fulfillment_id, `${p}.items[${n}].fulfillment_id`);
    if (x.category_id !== undefined)
      str(x.category_id, `${p}.items[${n}].category_id`);
  });
  const fs = arr(o.fulfillments, `${p}.fulfillments`);
  fs.forEach((f, n) => fulfillment(f, `${p}.fulfillments[${n}]`));
  if (requireBilling || o.billing !== undefined) {
    const billing = record(o.billing, `${p}.billing`);
    str(billing.name, `${p}.billing.name`);
    address(billing.address, `${p}.billing.address`);
    for (const k of ["phone", "email"]) {
      if (billing[k] !== undefined) str(billing[k], `${p}.billing.${k}`);
    }
  }
  ondcPayment(o.payment, `${p}.payment`);
  return o;
};
// Contract footnotes 24/61-64/69-70: collected_by is required for ON-ORDER
// and ON-FULFILLMENT, collection_amount only applies to ON-FULFILLMENT (CoD),
// and settlement_details are optional (LBNP's for CoD, LSP's for
// POST-FULFILLMENT).
const ondcPayment = (v: unknown, p: string) => {
  const payment = record(v, p);
  str(payment.type, `${p}.type`);
  if (!PAYMENT_TYPES.includes(payment.type))
    throw new InitValidationError(
      "must be ON-ORDER, ON-FULFILLMENT, or POST-FULFILLMENT",
      `${p}.type`,
    );
  if (payment.type !== "POST-FULFILLMENT" || payment.collected_by !== undefined)
    str(payment.collected_by, `${p}.collected_by`);
  if (
    payment.type === "ON-FULFILLMENT" ||
    payment["@ondc/org/collection_amount"] !== undefined
  )
    str(
      payment["@ondc/org/collection_amount"],
      `${p}.@ondc/org/collection_amount`,
    );
  if (payment["@ondc/org/settlement_details"] !== undefined) {
    const settlements = arr(
      payment["@ondc/org/settlement_details"],
      `${p}.@ondc/org/settlement_details`,
    );
    settlements.forEach((s, n) => {
      const sp = `${p}.@ondc/org/settlement_details[${n}]`;
      const x = record(s, sp);
      str(x.settlement_counterparty, `${sp}.settlement_counterparty`);
      str(x.settlement_type, `${sp}.settlement_type`);
      if (!SETTLEMENT_TYPES.includes(x.settlement_type))
        throw new InitValidationError(
          "must be upi, neft, or rtgs",
          `${sp}.settlement_type`,
        );
    });
  }
  return payment;
};
export const parseInitRequest = (value: unknown): OndcInitRequest => {
  const x = record(value, "request body");
  context(x.context, "init");
  const m = record(x.message, "message");
  order(m.order);
  return value as OndcInitRequest;
};
const quote = (v: unknown) => {
  const q = record(v, "message.order.quote");
  const price = record(q.price, "message.order.quote.price");
  str(price.currency, "message.order.quote.price.currency");
  str(price.value, "message.order.quote.price.value");
  const b = arr(q.breakup, "message.order.quote.breakup");
  b.forEach((x, n) => {
    const z = record(x, `message.order.quote.breakup[${n}]`);
    str(
      z["@ondc/org/item_id"],
      `message.order.quote.breakup[${n}].@ondc/org/item_id`,
    );
    const title = z["@ondc/org/title_type"];
    str(title, `message.order.quote.breakup[${n}].@ondc/org/title_type`);
    if (
      ![
        "delivery",
        "rto",
        "reverseqc",
        "tax",
        "diff",
        "tax_diff",
        "discount",
      ].includes(title)
    )
      throw new InitValidationError(
        "invalid quote title type",
        `message.order.quote.breakup[${n}].@ondc/org/title_type`,
      );
    const bp = record(z.price, `message.order.quote.breakup[${n}].price`);
    str(bp.currency, `message.order.quote.breakup[${n}].price.currency`);
    str(bp.value, `message.order.quote.breakup[${n}].price.value`);
  });
};
export const parseOnInitResponse = (value: unknown): OndcOnInitResponse => {
  const x = record(value, "callback body");
  context(x.context, "on_init");
  if (x.error !== undefined) {
    const e = record(x.error, "error");
    str(e.code, "error.code");
    str(e.message, "error.message");
    return value as OndcOnInitResponse;
  }
  const m = record(x.message, "message");
  const o = order(m.order, "message.order", false);
  if (o.quote === undefined)
    throw new InitValidationError(
      "is required for successful on_init",
      "message.order.quote",
    );
  quote(o.quote);
  if (o.cancellation_terms !== undefined) {
    arr(o.cancellation_terms, "message.order.cancellation_terms");
  }
  return value as OndcOnInitResponse;
};

// phone is mandatory on both contacts; email is mandatory for pickup but
// optional for delivery (contract comment on fulfillments[].end.contact.email).
const minimalContact = (v: unknown, p: string, emailRequired: boolean) => {
  const x = record(v, p);
  str(x.phone, `${p}.phone`);
  if (emailRequired || x.email !== undefined) str(x.email, `${p}.email`);
  return {
    phone: x.phone as string,
    ...(x.email !== undefined ? { email: x.email as string } : {}),
  };
};

export const parseMinimalInitRequest = (value: unknown): InitRequest => {
  const x = record(value, "request body");
  str(x.search_id, "search_id");
  for (const key of ["bpp_id", "provider_id", "item_id", "fulfillment_id"])
    if (x[key] !== undefined) str(x[key], key);
  if (
    x.quantity !== undefined &&
    (!Number.isInteger(x.quantity) || x.quantity < 1)
  )
    throw new InitValidationError("must be a positive integer", "quantity");
  const billing = record(x.billing, "billing");
  const billingAddress = record(billing.address, "billing.address");
  str(billing.name, "billing.name");
  str(billing.email, "billing.email");
  str(billing.tax_number, "billing.tax_number");
  str(billing.created_at, "billing.created_at");
  str(billing.updated_at, "billing.updated_at");
  for (const key of [
    "name",
    "building",
    "locality",
    "city",
    "state",
    "country",
  ])
    str(billingAddress[key], `billing.address.${key}`);
  str(billingAddress.area_code, "billing.address.area_code");
  if (billing.phone !== undefined) str(billing.phone, "billing.phone");
  if (billing.email !== undefined) str(billing.email, "billing.email");
  const payment = record(x.payment, "payment");
  str(payment.type, "payment.type");
  if (payment.type === "ON-FULFILLMENT")
    throw new InitValidationError(
      "cash on delivery (ON-FULFILLMENT) is not supported",
      "payment.type",
    );
  if (!ALLOWED_INIT_PAYMENT_TYPES.includes(payment.type))
    throw new InitValidationError(
      "must be ON-ORDER or POST-FULFILLMENT",
      "payment.type",
    );
  str(payment.collected_by, "payment.collected_by");
  if (payment.collected_by !== "BAP")
    throw new InitValidationError(
      "must be BAP for ON-ORDER / POST-FULFILLMENT",
      "payment.collected_by",
    );
  // amount maps to @ondc/org/collection_amount, which is CoD-only.
  if (payment.amount !== undefined)
    throw new InitValidationError(
      "is only applicable to cash on delivery; omit it",
      "payment.amount",
    );
  if (payment.currency !== undefined) str(payment.currency, "payment.currency");
  if (
    payment.settlement_details !== undefined &&
    !Array.isArray(payment.settlement_details)
  )
    throw new InitValidationError(
      "must be an array",
      "payment.settlement_details",
    );
  return {
    searchId: x.search_id,
    ...(x.bpp_id !== undefined ? { bppId: x.bpp_id } : {}),
    ...(x.provider_id !== undefined ? { providerId: x.provider_id } : {}),
    ...(x.item_id !== undefined ? { itemId: x.item_id } : {}),
    ...(x.fulfillment_id !== undefined
      ? { fulfillmentId: x.fulfillment_id }
      : {}),
    ...(x.quantity !== undefined ? { quantity: x.quantity } : {}),
    pickupContact: minimalContact(x.pickup_contact, "pickup_contact", true),
    deliveryContact: minimalContact(
      x.delivery_contact,
      "delivery_contact",
      false,
    ),
    billing: {
      name: billing.name,
      email: billing.email,
      ...(billing.phone ? { phone: billing.phone } : {}),
      taxNumber: billing.tax_number,
      createdAt: billing.created_at,
      updatedAt: billing.updated_at,
      address: {
        name: billingAddress.name,
        building: billingAddress.building,
        locality: billingAddress.locality,
        ...(billingAddress.street ? { street: billingAddress.street } : {}),
        city: billingAddress.city,
        state: billingAddress.state,
        country: billingAddress.country,
        areaCode: billingAddress.area_code,
      },
    },
    payment: {
      type: payment.type,
      collectedBy: payment.collected_by,
      ...(payment.currency !== undefined ? { currency: payment.currency } : {}),
      settlementDetails: payment.settlement_details ?? [],
    },
  };
};
