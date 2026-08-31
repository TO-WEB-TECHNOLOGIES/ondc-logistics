import type { ConfirmRequest } from "../types/confirm/internal.js";
import type { OndcConfirmRequest, OndcOnConfirmResponse } from "../types/confirm/ondc.js";

export class ConfirmValidationError extends Error {
  constructor(message: string, public readonly path?: string) {
    super(message);
    this.name = "ConfirmValidationError";
  }
}

const record = (v: unknown, p: string): Record<string, any> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new ConfirmValidationError("must be an object", p);
  return v as Record<string, any>;
};
const str = (v: unknown, p: string) => {
  if (typeof v !== "string" || !v.trim()) throw new ConfirmValidationError("must be a non-empty string", p);
  return v;
};
const arr = (v: unknown, p: string) => {
  if (!Array.isArray(v) || v.length === 0) throw new ConfirmValidationError("must be a non-empty array", p);
  return v;
};
const address = (v: unknown, p: string) => { const x = record(v, p); str(x.area_code, `${p}.area_code`); return x; };
const context = (v: unknown, action: "on_confirm") => {
  const c = record(v, "context");
  if (c.action !== action) throw new ConfirmValidationError(`must be ${action}`, "context.action");
  for (const k of ["domain", "country", "city", "core_version", "bap_id", "bap_uri", "transaction_id", "message_id", "timestamp"]) str(c[k], `context.${k}`);
  if (c.bpp_id !== undefined) str(c.bpp_id, "context.bpp_id");
  if (c.bpp_uri !== undefined) str(c.bpp_uri, "context.bpp_uri");
  if (Number.isNaN(new Date(c.timestamp).getTime())) throw new ConfirmValidationError("must be a valid timestamp", "context.timestamp");
  return c;
};
const validateBasicOrder = (v: unknown, p = "message.order") => {
  const o = record(v, p);
  str(o.id, `${p}.id`); str(o.state, `${p}.state`); str(o.created_at, `${p}.created_at`); str(o.updated_at, `${p}.updated_at`);
  const provider = record(o.provider, `${p}.provider`); str(provider.id, `${p}.provider.id`);
  const locations = arr(provider.locations, `${p}.provider.locations`);
  locations.forEach((x: any, i: number) => str(record(x, `${p}.provider.locations[${i}]`).id, `${p}.provider.locations[${i}].id`));
  const items = arr(o.items, `${p}.items`); const fulfillments = arr(o.fulfillments, `${p}.fulfillments`);
  const fids = new Set(fulfillments.map((x: any, i: number) => str(record(x, `${p}.fulfillments[${i}]`).id, `${p}.fulfillments[${i}].id`)));
  items.forEach((x: any, i: number) => {
    const z = record(x, `${p}.items[${i}]`); str(z.id, `${p}.items[${i}].id`); str(z.fulfillment_id, `${p}.items[${i}].fulfillment_id`);
    if (!fids.has(z.fulfillment_id)) throw new ConfirmValidationError("does not reference an order fulfillment", `${p}.items[${i}].fulfillment_id`);
    str(z.category_id, `${p}.items[${i}].category_id`);
    const t = record(z.time, `${p}.items[${i}].time`); str(t.label, `${p}.items[${i}].time.label`); str(t.duration, `${p}.items[${i}].time.duration`); str(t.timestamp, `${p}.items[${i}].time.timestamp`);
  });
  fulfillments.forEach((x: any, i: number) => {
    const z = record(x, `${p}.fulfillments[${i}]`); str(z.type, `${p}.fulfillments[${i}].type`); if (z.type !== "Delivery") return;
    for (const side of ["start", "end"]) { const q = record(z[side], `${p}.fulfillments[${i}].${side}`); const time = record(q.time, `${p}.fulfillments[${i}].${side}.time`); str(time.duration, `${p}.fulfillments[${i}].${side}.time.duration`); const person = record(q.person, `${p}.fulfillments[${i}].${side}.person`); str(person.name, `${p}.fulfillments[${i}].${side}.person.name`); }
  });
  const q = record(o.quote, `${p}.quote`); const price = record(q.price, `${p}.quote.price`); str(price.currency, `${p}.quote.price.currency`); str(price.value, `${p}.quote.price.value`); arr(q.breakup, `${p}.quote.breakup`);
  const payment = record(o.payment, `${p}.payment`); str(payment.type, `${p}.payment.type`); str(payment.collected_by, `${p}.payment.collected_by`); str(payment["@ondc/org/collection_amount"], `${p}.payment.@ondc/org/collection_amount`); arr(payment["@ondc/org/settlement_details"], `${p}.payment.@ondc/org/settlement_details`);
  const linked = record(o["@ondc/org/linked_order"], `${p}.@ondc/org/linked_order`); const li = arr(linked.items, `${p}.@ondc/org/linked_order.items`);
  li.forEach((x: any, i: number) => { const z = record(x, `${p}.@ondc/org/linked_order.items[${i}]`); const d = record(z.descriptor, `${p}.@ondc/org/linked_order.items[${i}].descriptor`); str(d.name, `${p}.@ondc/org/linked_order.items[${i}].descriptor.name`); const qn = record(z.quantity, `${p}.@ondc/org/linked_order.items[${i}].quantity`); if (qn.count === undefined || qn.count === null) throw new ConfirmValidationError("is required", `${p}.@ondc/org/linked_order.items[${i}].quantity.count`); const measure = record(qn.measure, `${p}.@ondc/org/linked_order.items[${i}].quantity.measure`); str(measure.unit, `${p}.@ondc/org/linked_order.items[${i}].quantity.measure.unit`); if (measure.value === undefined || measure.value === null) throw new ConfirmValidationError("is required", `${p}.@ondc/org/linked_order.items[${i}].quantity.measure.value`); const ip = record(z.price, `${p}.@ondc/org/linked_order.items[${i}].price`); str(ip.currency, `${p}.@ondc/org/linked_order.items[${i}].price.currency`); str(ip.value, `${p}.@ondc/org/linked_order.items[${i}].price.value`); });
  const lp = record(linked.provider, `${p}.@ondc/org/linked_order.provider`); const ld = record(lp.descriptor, `${p}.@ondc/org/linked_order.provider.descriptor`); str(ld.name, `${p}.@ondc/org/linked_order.provider.descriptor.name`); const la = address(lp.address, `${p}.@ondc/org/linked_order.provider.address`); for (const k of ["name", "building", "locality", "city", "state"]) str(la[k], `${p}.@ondc/org/linked_order.provider.address.${k}`);
  const lo = record(linked.order, `${p}.@ondc/org/linked_order.order`); str(lo.id, `${p}.@ondc/org/linked_order.order.id`); const w = record(lo.weight, `${p}.@ondc/org/linked_order.order.weight`); str(w.unit, `${p}.@ondc/org/linked_order.order.weight.unit`); if (w.value === undefined || w.value === null) throw new ConfirmValidationError("is required", `${p}.@ondc/org/linked_order.order.weight.value`); const dims = record(lo.dimensions, `${p}.@ondc/org/linked_order.order.dimensions`); for (const k of ["length", "breadth", "height"]) { const d = record(dims[k], `${p}.@ondc/org/linked_order.order.dimensions.${k}`); str(d.unit, `${p}.@ondc/org/linked_order.order.dimensions.${k}.unit`); if (d.value === undefined || d.value === null) throw new ConfirmValidationError("is required", `${p}.@ondc/org/linked_order.order.dimensions.${k}.value`); }
  return o;
};
const requireAcceptance = (order: any) => { const tags = Array.isArray(order.tags) ? order.tags : []; const bap = tags.find((x: any) => x?.code === "bap_terms"); if (!bap?.list?.some((x: any) => x?.code === "accept_bpp_terms" && x?.value === "Y")) throw new ConfirmValidationError("bap_terms.accept_bpp_terms=Y is required", "message.order.tags"); };
export const parseConfirmRequest = (value: unknown): ConfirmRequest => { const x = record(value, "request body"); const result: ConfirmRequest = { initTransactionId: str(x.initTransactionId, "initTransactionId") }; if (x.order !== undefined) result.order = record(x.order, "order"); return result; };
export const validateConfirmPayload = (value: OndcConfirmRequest): void => { if (value.context.action !== "confirm") throw new ConfirmValidationError("must be confirm", "context.action"); validateBasicOrder(value.message.order); requireAcceptance(value.message.order); };
export const parseOnConfirmResponse = (value: unknown): OndcOnConfirmResponse => { const x = record(value, "callback body"); context(x.context, "on_confirm"); if (x.error !== undefined) { const e = record(x.error, "error"); str(e.code, "error.code"); str(e.message, "error.message"); return value as OndcOnConfirmResponse; } const m = record(x.message, "message"); validateBasicOrder(m.order); return value as OndcOnConfirmResponse; };
