import type { SearchRequest } from "../types/search/internal.js";
import type { OndcAddress, OndcSearchRequest } from "../types/search/ondc.js";
export interface SearchProtocolOptions {
  domain: string;
  country: string;
  city: string;
  coreVersion: string;
  bapId: string;
  bapUri: string;
  transactionId: string;
  messageId: string;
  timestamp: string;
  ttl?: string;
}
const decimalString = (value: string | number) => String(value);
const mapAddress = (
  address: SearchRequest["start"]["address"],
): OndcAddress => ({
  name: address.name,
  building: address.building,
  locality: address.locality,
  street: address.street,
  city: address.city,
  state: address.state,
  country: address.country,
  area_code: address.areaCode,
});
export const mapSearchRequestToOndc = (
  request: SearchRequest,
  options: SearchProtocolOptions,
): OndcSearchRequest => {
  const intent: OndcSearchRequest["message"]["intent"] = {
    category: { id: request.categoryId },
    provider: {
      time: {
        days: request.schedule!.days,
        range: {
          start: request.schedule!.rangeStart,
          end: request.schedule!.rangeEnd,
        },
      },
    },
    fulfillment: {
      type: request.fulfillmentType,
      start: {
        location: {
          gps: request.start.gps,
          address: mapAddress(request.start.address),
        },
        authorization: { type: request.authorization.startType },
      },
      end: {
        location: {
          gps: request.end.gps,
          address: mapAddress(request.end.address),
        },
        authorization: { type: request.authorization.endType },
      },
    },
  };
  if (request.payload)
    intent["@ondc/org/payload_details"] = {
      weight: request.payload.weight,
      dimensions: request.payload.dimensions,
      category: request.payload.category,
      value: {
        currency: request.payload.value.currency,
        value: decimalString(request.payload.value.amount),
      },
      dangerous_goods: request.payload.dangerousGoods,
    };
  if (request.payment)
    intent.payment = {
      type: request.payment.type,
      "@ondc/org/collection_amount":
        request.payment.collectionAmount === undefined
          ? undefined
          : decimalString(request.payment.collectionAmount),
    };
  return {
    context: {
      domain: options.domain,
      country: options.country,
      city: options.city,
      action: "search",
      core_version: options.coreVersion,
      bap_id: options.bapId,
      bap_uri: options.bapUri,
      transaction_id: options.transactionId,
      message_id: options.messageId,
      timestamp: options.timestamp,
      ttl: options.ttl,
    },
    message: { intent },
  };
};
