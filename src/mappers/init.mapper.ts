import type { InitRequest } from "../types/init/internal.js";
import type { OndcInitRequest } from "../types/init/ondc.js";
import type { OndcSearchRequest, OndcOnSearchResponse } from "../types/search/ondc.js";

const address = (x: any) => ({ name: x.name, building: x.building, locality: x.locality, street: x.street, city: x.city, state: x.state, country: x.country, area_code: x.areaCode });
const location = (x: any, auth?: string) => ({ location: { gps: x.gps, address: address(x.address) }, ...(auth ? { authorization: { type: auth } } : {}) });

export function mapInitRequestToOndc(input: InitRequest, search: OndcSearchRequest, callback: OndcOnSearchResponse, ids: { transactionId: string; messageId: string; timestamp: string }, protocol: { domain: string; country: string; city: string; coreVersion: string; bapId: string; bapUri: string; ttl?: string }): OndcInitRequest {
  const intent = search.message.intent;
  const provider = callback.message.catalog["bpp/providers"].find((p) => p.id === input.providerId);
  const fulfillment = provider?.fulfillments?.find((f) => f.id === input.fulfillmentId);
  const payload = intent["@ondc/org/payload_details"];
  const billingAddress = address(input.billing.address);
  const payment: Record<string, unknown> = { type: input.payment.type, collected_by: input.payment.collectedBy ?? "BAP" };
  if (input.payment.amount !== undefined) payment["@ondc/org/collection_amount"] = String(input.payment.amount);
  if (input.payment.currency) payment.currency = input.payment.currency;
  if (input.payment.settlementDetails) payment["@ondc/org/settlement_details"] = input.payment.settlementDetails;
  return {
    context: { domain: protocol.domain, country: protocol.country, city: protocol.city, action: "init", core_version: protocol.coreVersion, bap_id: protocol.bapId, bap_uri: protocol.bapUri, transaction_id: ids.transactionId, message_id: ids.messageId, timestamp: ids.timestamp, ttl: protocol.ttl, bpp_id: input.bppId, bpp_uri: callback.context.bpp_uri ?? "" },
    message: { order: {
      provider: { id: provider!.id },
      items: [{ id: input.itemId, quantity: { count: input.quantity ?? 1 } }],
      fulfillments: [{ id: fulfillment!.id, type: fulfillment!.type ?? intent.fulfillment.type, start: location(intent.fulfillment.start, intent.fulfillment.start.authorization?.type), end: location(intent.fulfillment.end, intent.fulfillment.end.authorization?.type) }],
      billing: { name: input.billing.name, email: input.billing.email, phone: input.billing.phone, address: billingAddress },
      payment,
      ...(payload ? { "@ondc/org/payload_details": payload } : {}),
    } },
  };
}
