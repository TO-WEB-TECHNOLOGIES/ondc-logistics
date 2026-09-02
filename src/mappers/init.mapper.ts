import type {
  InitRequest,
  ResolvedInitSelection,
} from "../types/init/internal.js";
import type { OndcInitRequest } from "../types/init/ondc.js";
import type { SearchAddress } from "../types/search/internal.js";

export interface InitProtocolOptions {
  domain: string;
  country: string;
  city: string;
  coreVersion: string;
  bapId: string;
  bapUri: string;
  ttl?: string;
}
const address = (a: SearchAddress) => ({
  name: a.name,
  building: a.building,
  locality: a.locality,
  ...(a.street ? { street: a.street } : {}),
  city: a.city,
  state: a.state,
  country: a.country,
  area_code: a.areaCode,
});
export const mapInitRequestToOndc = (
  request: InitRequest,
  selected: ResolvedInitSelection,
  protocol: InitProtocolOptions & {
    transactionId: string;
    messageId: string;
    timestamp: string;
  },
): OndcInitRequest => {
  const f = selected.fulfillment;
  const start = selected.search.message.intent.fulfillment.start;
  const end = selected.search.message.intent.fulfillment.end;
  const searchStart = start.location;
  const searchEnd = end.location;
  const item = {
    id: selected.item.id,
    ...(request.quantity !== undefined
      ? { quantity: { count: request.quantity } }
      : {}),
    ...(selected.item.fulfillment_id
      ? { fulfillment_id: selected.item.fulfillment_id }
      : {}),
    ...(selected.item.category_id
      ? { category_id: selected.item.category_id }
      : {}),
    ...(selected.item.descriptor
      ? { descriptor: selected.item.descriptor }
      : {}),
    ...(selected.item.time ? { time: selected.item.time } : {}),
  };
  const orderFulfillment = {
    id: f.id,
    type: f.type ?? "Delivery",
    start: {
      location: searchStart,
      authorization: start.authorization,
      contact: request.pickupContact,
    },
    end: {
      location: searchEnd,
      authorization: end.authorization,
      contact: request.deliveryContact,
    },
    ...(f.tags?.length ? { tags: f.tags } : {}),
  };
  return {
    context: {
      domain: protocol.domain,
      country: protocol.country,
      city: protocol.city,
      action: "init",
      core_version: protocol.coreVersion,
      bap_id: protocol.bapId,
      bap_uri: protocol.bapUri,
      bpp_id: selected.bppId,
      bpp_uri: selected.bppUri,
      transaction_id: protocol.transactionId,
      message_id: protocol.messageId,
      timestamp: protocol.timestamp,
      ttl: protocol.ttl,
    },

    message: {
      order: {
        provider: {
          id: selected.provider.id,
          locations: selected.provider.locations ?? [],
        },

        items: [item],

        fulfillments: [orderFulfillment],

        billing: {
          name: request.billing.name,
          email: request.billing.email,
          ...(request.billing.phone ? { phone: request.billing.phone } : {}),
          tax_number: request.billing.taxNumber,
          created_at: request.billing.createdAt,
          updated_at: request.billing.updatedAt,
          address: address(request.billing.address),
        },

        payment: {
          type: request.payment.type,
          collected_by: request.payment.collectedBy,
          "@ondc/org/collection_amount": String(request.payment.amount),
          "@ondc/org/settlement_details": request.payment.settlementDetails,
        },
      },
    },
  };
};
