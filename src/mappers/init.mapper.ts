import {
  buildRequestContext,
  contextBaseFromProtocol,
} from "../utils/ondc-context.js";
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
  const start = selected.searchEnvelope.start;
  const end = selected.searchEnvelope.end;
  const item = {
    id: selected.item.id,
    ...(request.quantity !== undefined
      ? { quantity: { count: request.quantity } }
      : {}),
    ...(selected.item.fulfillmentId
      ? { fulfillment_id: selected.item.fulfillmentId }
      : {}),
    ...(selected.item.categoryId
      ? { category_id: selected.item.categoryId }
      : {}),
    ...(selected.item.descriptor
      ? {
          descriptor: {
            ...(selected.item.descriptor.code
              ? { code: selected.item.descriptor.code }
              : {}),
            ...(selected.item.descriptor.name
              ? { name: selected.item.descriptor.name }
              : {}),
            ...(selected.item.descriptor.shortDesc
              ? { short_desc: selected.item.descriptor.shortDesc }
              : {}),
            ...(selected.item.descriptor.longDesc
              ? { long_desc: selected.item.descriptor.longDesc }
              : {}),
          },
        }
      : {}),
    ...(selected.item.time ? { time: selected.item.time } : {}),
  };
  const orderFulfillment = {
    id: f.id,
    type: f.type ?? "Delivery",
    start: {
      location: { gps: start.gps, address: address(start.address) },
      authorization: { type: start.authorizationType },
      contact: request.pickupContact,
      ...(f.pickupDuration ? { time: { duration: f.pickupDuration } } : {}),
    },
    end: {
      location: { gps: end.gps, address: address(end.address) },
      authorization: { type: end.authorizationType },
      contact: request.deliveryContact,
    },
    ...(f.tags?.length ? { tags: f.tags } : {}),
  };

  return {
    context: buildRequestContext("init", {
      base: contextBaseFromProtocol(protocol),
      bppId: selected.bppId,
      bppUri: selected.bppUri,
      transactionId: protocol.transactionId,
      messageId: protocol.messageId,
      timestamp: protocol.timestamp,
      ttl: protocol.ttl,
    }),

    message: {
      order: {
        provider: {
          id: selected.provider.id,
          ...(selected.providerLocations.length
            ? {
                // Per contract, /init's provider.locations[] is id-only (the
                // BPP already has full location detail from /on_search) —
                // sending gps/address here gets NACKed as unexpected
                // additional properties.
                locations: selected.providerLocations.map((l) => ({ id: l.id })),
              }
            : {}),
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
          // Omit rather than send `[]` — the validator rejects an empty array.
          ...(request.payment.settlementDetails.length > 0
            ? { "@ondc/org/settlement_details": request.payment.settlementDetails }
            : {}),
        },
      },
    },
  };
};
