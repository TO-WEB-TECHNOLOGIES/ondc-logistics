import type { OndcTag } from "../types/search/ondc.js";
import type { OndcInitFulfillment, OndcInitOrder } from "../types/init/ondc.js";

// ---------------------------------------------------------------------------
// database records -> init aggregate -> ONDC /init|/on_init order object
// ONDC /init|/on_init order object -> database records
//
// These are the only two directions any repository should use to move
// between an OndcInitOrder and the init_order_* tables — no repository or
// service reads/writes raw JSON for init/on_init/confirm.
// ---------------------------------------------------------------------------

export interface ExtractedInitOrder {
  bppId?: string;
  bppUri?: string;
  providerId: string;
  providerLocationIds: string[];
  billing?: {
    name: string;
    email: string;
    phone?: string;
    taxNumber?: string;
    createdAt?: string;
    updatedAt?: string;
    address?: {
      name?: string;
      building?: string;
      locality?: string;
      street?: string;
      city?: string;
      state?: string;
      country?: string;
      areaCode?: string;
    };
  };
  payment?: {
    type?: string;
    collectedBy?: string;
    collectionAmount?: string;
  };
  quote?: {
    priceAmount?: string;
    priceCurrency?: string;
    ttl?: string;
  };
  orderCreatedAt?: string;
  orderUpdatedAt?: string;
  items: Array<{
    itemId: string;
    categoryId?: string;
    fulfillmentId?: string;
    descriptorCode?: string;
    descriptorName?: string;
    descriptorShortDesc?: string;
    descriptorLongDesc?: string;
    quantityCount?: number;
    timeLabel?: string;
    timeDuration?: string;
    timeTimestamp?: string;
  }>;
  fulfillments: Array<{
    fulfillmentId: string;
    type?: string;
    awbNo?: string;
    tracking?: boolean;
    stateCode?: string;
    stateShortDesc?: string;
    start: ExtractedFulfillmentSide;
    end: ExtractedFulfillmentSide;
    tags: Array<{ code: string; list: Array<{ code: string; value?: string }> }>;
  }>;
  quoteBreakups: Array<{
    itemId: string;
    titleType: string;
    priceAmount?: string;
    priceCurrency?: string;
  }>;
  settlements: Array<{
    settlementCounterparty: string;
    settlementType: string;
    beneficiaryName?: string;
    upiAddress?: string;
    settlementBankAccountNo?: string;
    settlementIfscCode?: string;
    settlementStatus?: string;
    settlementReference?: string;
    settlementTimestamp?: string;
  }>;
  cancellationTerms: Array<{
    fulfillmentStateCode?: string;
    fulfillmentStateShortDesc?: string;
    cancellationFeePercentage?: string;
    cancellationFeeAmount?: string;
    cancellationFeeCurrency?: string;
  }>;
  tags: Array<{ code: string; list: Array<{ code: string; value?: string }> }>;
  linkedOrder?: {
    retailOrderId?: string;
    weightUnit?: string;
    weightValue?: string;
    lengthUnit?: string;
    lengthValue?: string;
    breadthUnit?: string;
    breadthValue?: string;
    heightUnit?: string;
    heightValue?: string;
    providerDescriptorName?: string;
    providerAddress?: {
      name?: string;
      building?: string;
      locality?: string;
      city?: string;
      state?: string;
      areaCode?: string;
    };
    items: Array<{
      descriptorName?: string;
      quantityCount?: number;
      quantityMeasureUnit?: string;
      quantityMeasureValue?: string;
      priceAmount?: string;
      priceCurrency?: string;
    }>;
  };
}

interface ExtractedFulfillmentSide {
  gps?: string;
  address?: {
    name?: string;
    building?: string;
    locality?: string;
    street?: string;
    city?: string;
    state?: string;
    country?: string;
    areaCode?: string;
  };
  authorizationType?: string;
  contactPhone?: string;
  contactEmail?: string;
  personName?: string;
  agentName?: string;
  agentPhone?: string;
  vehicleRegistration?: string;
  timeDuration?: string;
  timeTimestamp?: string;
  timeRangeStart?: string;
  timeRangeEnd?: string;
  instructionCode?: string;
  instructionShortDesc?: string;
  instructionLongDesc?: string;
  instructionAdditionalDescContentType?: string;
  instructionAdditionalDescUrl?: string;
  instructionImages: string[];
}

const extractAddress = (a: Record<string, unknown> | undefined) =>
  a
    ? {
        name: a.name as string | undefined,
        building: a.building as string | undefined,
        locality: a.locality as string | undefined,
        street: a.street as string | undefined,
        city: a.city as string | undefined,
        state: a.state as string | undefined,
        country: a.country as string | undefined,
        areaCode: a.area_code as string | undefined,
      }
    : undefined;

const extractSide = (
  side: OndcInitFulfillment["start"] | undefined,
): ExtractedFulfillmentSide => ({
  gps: side?.location?.gps,
  address: extractAddress(side?.location?.address as Record<string, unknown>),
  authorizationType: side?.authorization?.type,
  contactPhone: side?.contact?.phone,
  contactEmail: side?.contact?.email,
  personName: side?.person?.name,
  agentName: (side as any)?.agent?.name,
  agentPhone: (side as any)?.agent?.phone,
  vehicleRegistration: (side as any)?.vehicle?.registration,
  timeDuration: side?.time?.duration,
  timeTimestamp: side?.time?.timestamp,
  timeRangeStart: side?.time?.range?.start,
  timeRangeEnd: side?.time?.range?.end,
  instructionCode: side?.instructions?.code,
  instructionShortDesc: side?.instructions?.short_desc,
  instructionLongDesc: side?.instructions?.long_desc,
  instructionAdditionalDescContentType:
    side?.instructions?.additional_desc?.content_type,
  instructionAdditionalDescUrl: side?.instructions?.additional_desc?.url,
  instructionImages: side?.instructions?.images ?? [],
});

const extractTags = (tags: OndcTag[] | undefined) =>
  (tags ?? []).map((t) => ({
    code: t.code,
    list: (t.list ?? []).map((l) => ({ code: l.code, value: l.value })),
  }));

export const extractInitOrder = (
  order: OndcInitOrder,
  context: { bppId?: string; bppUri?: string },
): ExtractedInitOrder => {
  const billing = order.billing as Record<string, unknown> | undefined;
  const payment = order.payment as Record<string, unknown> | undefined;
  const quote = order.quote as Record<string, unknown> | undefined;
  const linkedOrder = order["@ondc/org/linked_order"] as
    | Record<string, unknown>
    | undefined;

  return {
    bppId: context.bppId,
    bppUri: context.bppUri,
    providerId: order.provider.id,
    providerLocationIds: (order.provider.locations ?? []).map((l) => l.id),
    billing: billing
      ? {
          name: billing.name as string,
          email: billing.email as string,
          phone: billing.phone as string | undefined,
          taxNumber: billing.tax_number as string | undefined,
          createdAt: billing.created_at as string | undefined,
          updatedAt: billing.updated_at as string | undefined,
          address: extractAddress(billing.address as Record<string, unknown>),
        }
      : undefined,
    payment: payment
      ? {
          type: payment.type as string | undefined,
          collectedBy: payment.collected_by as string | undefined,
          collectionAmount: payment["@ondc/org/collection_amount"] as
            | string
            | undefined,
        }
      : undefined,
    quote: quote
      ? {
          priceAmount: (quote.price as Record<string, unknown> | undefined)
            ?.value as string | undefined,
          priceCurrency: (quote.price as Record<string, unknown> | undefined)
            ?.currency as string | undefined,
          ttl: quote.ttl as string | undefined,
        }
      : undefined,
    orderCreatedAt: order.created_at,
    orderUpdatedAt: order.updated_at,
    items: order.items.map((item) => ({
      itemId: item.id,
      categoryId: item.category_id,
      fulfillmentId: item.fulfillment_id,
      descriptorCode: item.descriptor?.code,
      descriptorName: item.descriptor?.name,
      descriptorShortDesc: item.descriptor?.short_desc,
      descriptorLongDesc: item.descriptor?.long_desc,
      quantityCount: item.quantity?.count,
      timeLabel: item.time?.label,
      timeDuration: item.time?.duration,
      timeTimestamp: item.time?.timestamp,
    })),
    fulfillments: order.fulfillments.map((f) => ({
      fulfillmentId: f.id,
      type: f.type,
      awbNo: f["@ondc/org/awb_no"],
      tracking: f.tracking,
      stateCode: f.state?.descriptor?.code,
      stateShortDesc: f.state?.descriptor?.short_desc,
      start: extractSide(f.start),
      end: extractSide(f.end),
      tags: extractTags(f.tags),
    })),
    quoteBreakups: (
      (quote?.breakup as Array<Record<string, unknown>> | undefined) ?? []
    ).map((b) => ({
      itemId: b["@ondc/org/item_id"] as string,
      titleType: b["@ondc/org/title_type"] as string,
      priceAmount: (b.price as Record<string, unknown> | undefined)?.value as
        | string
        | undefined,
      priceCurrency: (b.price as Record<string, unknown> | undefined)
        ?.currency as string | undefined,
    })),
    settlements: (
      (payment?.["@ondc/org/settlement_details"] as
        | Array<Record<string, unknown>>
        | undefined) ?? []
    ).map((s) => ({
      settlementCounterparty: s.settlement_counterparty as string,
      settlementType: s.settlement_type as string,
      beneficiaryName: s.beneficiary_name as string | undefined,
      upiAddress: s.upi_address as string | undefined,
      settlementBankAccountNo: s.settlement_bank_account_no as
        | string
        | undefined,
      settlementIfscCode: s.settlement_ifsc_code as string | undefined,
      settlementStatus: s.settlement_status as string | undefined,
      settlementReference: s.settlement_reference as string | undefined,
      settlementTimestamp: s.settlement_timestamp as string | undefined,
    })),
    cancellationTerms: (
      (order.cancellation_terms as Array<Record<string, unknown>> | undefined) ??
      []
    ).map((c) => {
      const state = c.fulfillment_state as Record<string, unknown> | undefined;
      const descriptor = state?.descriptor as Record<string, unknown> | undefined;
      const fee = c.cancellation_fee as Record<string, unknown> | undefined;
      const amount = fee?.amount as Record<string, unknown> | undefined;
      return {
        fulfillmentStateCode: descriptor?.code as string | undefined,
        fulfillmentStateShortDesc: descriptor?.short_desc as string | undefined,
        cancellationFeePercentage: fee?.percentage as string | undefined,
        cancellationFeeAmount: amount?.value as string | undefined,
        cancellationFeeCurrency: amount?.currency as string | undefined,
      };
    }),
    tags: extractTags(order.tags),
    linkedOrder: linkedOrder
      ? {
          retailOrderId: (linkedOrder.order as Record<string, unknown> | undefined)
            ?.id as string | undefined,
          weightUnit: (
            (linkedOrder.order as Record<string, unknown> | undefined)
              ?.weight as Record<string, unknown> | undefined
          )?.unit as string | undefined,
          weightValue: (
            (linkedOrder.order as Record<string, unknown> | undefined)
              ?.weight as Record<string, unknown> | undefined
          )?.value as string | undefined,
          lengthUnit: (
            (
              (linkedOrder.order as Record<string, unknown> | undefined)
                ?.dimensions as Record<string, unknown> | undefined
            )?.length as Record<string, unknown> | undefined
          )?.unit as string | undefined,
          lengthValue: (
            (
              (linkedOrder.order as Record<string, unknown> | undefined)
                ?.dimensions as Record<string, unknown> | undefined
            )?.length as Record<string, unknown> | undefined
          )?.value as string | undefined,
          breadthUnit: (
            (
              (linkedOrder.order as Record<string, unknown> | undefined)
                ?.dimensions as Record<string, unknown> | undefined
            )?.breadth as Record<string, unknown> | undefined
          )?.unit as string | undefined,
          breadthValue: (
            (
              (linkedOrder.order as Record<string, unknown> | undefined)
                ?.dimensions as Record<string, unknown> | undefined
            )?.breadth as Record<string, unknown> | undefined
          )?.value as string | undefined,
          heightUnit: (
            (
              (linkedOrder.order as Record<string, unknown> | undefined)
                ?.dimensions as Record<string, unknown> | undefined
            )?.height as Record<string, unknown> | undefined
          )?.unit as string | undefined,
          heightValue: (
            (
              (linkedOrder.order as Record<string, unknown> | undefined)
                ?.dimensions as Record<string, unknown> | undefined
            )?.height as Record<string, unknown> | undefined
          )?.value as string | undefined,
          providerDescriptorName: (
            (linkedOrder.provider as Record<string, unknown> | undefined)
              ?.descriptor as Record<string, unknown> | undefined
          )?.name as string | undefined,
          providerAddress: extractAddress(
            (linkedOrder.provider as Record<string, unknown> | undefined)
              ?.address as Record<string, unknown>,
          ),
          items: (
            (linkedOrder.items as Array<Record<string, unknown>> | undefined) ??
            []
          ).map((item) => {
            const quantity = item.quantity as Record<string, unknown> | undefined;
            const measure = quantity?.measure as Record<string, unknown> | undefined;
            const price = item.price as Record<string, unknown> | undefined;
            return {
              descriptorName: (
                item.descriptor as Record<string, unknown> | undefined
              )?.name as string | undefined,
              quantityCount: quantity?.count as number | undefined,
              quantityMeasureUnit: measure?.unit as string | undefined,
              quantityMeasureValue: measure?.value as string | undefined,
              priceAmount: price?.value as string | undefined,
              priceCurrency: price?.currency as string | undefined,
            };
          }),
        }
      : undefined,
  };
};

// ---------------------------------------------------------------------------
// Reconstruction: fetched init_order_* rows -> OndcInitOrder
// ---------------------------------------------------------------------------

export interface FetchedInitOrder {
  providerId: string;
  providerLocationIds: string[];
  billingName?: string | null;
  billingEmail?: string | null;
  billingPhone?: string | null;
  billingTaxNumber?: string | null;
  billingCreatedAt?: Date | null;
  billingUpdatedAt?: Date | null;
  billingAddressName?: string | null;
  billingAddressBuilding?: string | null;
  billingAddressLocality?: string | null;
  billingAddressStreet?: string | null;
  billingAddressCity?: string | null;
  billingAddressState?: string | null;
  billingAddressCountry?: string | null;
  billingAddressAreaCode?: string | null;
  paymentType?: string | null;
  paymentCollectedBy?: string | null;
  paymentCollectionAmount?: string | null;
  quotePriceAmount?: string | null;
  quotePriceCurrency?: string | null;
  quoteTtl?: string | null;
  orderCreatedAt?: Date | null;
  orderUpdatedAt?: Date | null;
  items: Array<{
    itemId: string;
    categoryId?: string | null;
    fulfillmentId?: string | null;
    descriptorCode?: string | null;
    descriptorName?: string | null;
    descriptorShortDesc?: string | null;
    descriptorLongDesc?: string | null;
    quantityCount?: number | null;
    timeLabel?: string | null;
    timeDuration?: string | null;
    timeTimestamp?: Date | null;
  }>;
  fulfillments: Array<{
    fulfillmentId: string;
    type?: string | null;
    awbNo?: string | null;
    tracking?: boolean | null;
    stateCode?: string | null;
    stateShortDesc?: string | null;
    start: FetchedFulfillmentSide;
    end: FetchedFulfillmentSide;
    tags: Array<{ code: string; values: Array<{ code: string; value?: string | null }> }>;
  }>;
  quoteBreakups: Array<{
    itemId: string;
    titleType: string;
    priceAmount?: string | null;
    priceCurrency?: string | null;
  }>;
  settlements: Array<{
    settlementCounterparty: string;
    settlementType: string;
    beneficiaryName?: string | null;
    upiAddress?: string | null;
    settlementBankAccountNo?: string | null;
    settlementIfscCode?: string | null;
    settlementStatus?: string | null;
    settlementReference?: string | null;
    settlementTimestamp?: Date | null;
  }>;
  cancellationTerms: Array<{
    fulfillmentStateCode?: string | null;
    fulfillmentStateShortDesc?: string | null;
    cancellationFeePercentage?: string | null;
    cancellationFeeAmount?: string | null;
    cancellationFeeCurrency?: string | null;
  }>;
  tags: Array<{ code: string; values: Array<{ code: string; value?: string | null }> }>;
  linkedOrder?: {
    retailOrderId?: string | null;
    weightUnit?: string | null;
    weightValue?: string | null;
    lengthUnit?: string | null;
    lengthValue?: string | null;
    breadthUnit?: string | null;
    breadthValue?: string | null;
    heightUnit?: string | null;
    heightValue?: string | null;
    providerDescriptorName?: string | null;
    providerAddressName?: string | null;
    providerAddressBuilding?: string | null;
    providerAddressLocality?: string | null;
    providerAddressCity?: string | null;
    providerAddressState?: string | null;
    providerAddressAreaCode?: string | null;
    items: Array<{
      descriptorName?: string | null;
      quantityCount?: number | null;
      quantityMeasureUnit?: string | null;
      quantityMeasureValue?: string | null;
      priceAmount?: string | null;
      priceCurrency?: string | null;
    }>;
  };
}

interface FetchedFulfillmentSide {
  gps?: string | null;
  addressName?: string | null;
  addressBuilding?: string | null;
  addressLocality?: string | null;
  addressStreet?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  addressCountry?: string | null;
  addressAreaCode?: string | null;
  authorizationType?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  personName?: string | null;
  agentName?: string | null;
  agentPhone?: string | null;
  vehicleRegistration?: string | null;
  timeDuration?: string | null;
  timeTimestamp?: Date | null;
  timeRangeStart?: Date | null;
  timeRangeEnd?: Date | null;
  instructionCode?: string | null;
  instructionShortDesc?: string | null;
  instructionLongDesc?: string | null;
  instructionAdditionalDescContentType?: string | null;
  instructionAdditionalDescUrl?: string | null;
  instructionImages: string[];
}

const iso = (d?: Date | null) => (d ? d.toISOString() : undefined);
const undef = <T>(v: T | null | undefined) => (v === null ? undefined : v);

const buildAddress = (a: {
  name?: string | null;
  building?: string | null;
  locality?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  areaCode?: string | null;
}) => ({
  name: undef(a.name),
  building: undef(a.building),
  locality: undef(a.locality),
  street: undef(a.street),
  city: undef(a.city),
  state: undef(a.state),
  country: undef(a.country),
  area_code: undef(a.areaCode),
});

const buildSide = (side: FetchedFulfillmentSide) => ({
  location: {
    gps: undef(side.gps) as string,
    address: buildAddress({
      name: side.addressName,
      building: side.addressBuilding,
      locality: side.addressLocality,
      street: side.addressStreet,
      city: side.addressCity,
      state: side.addressState,
      country: side.addressCountry,
      areaCode: side.addressAreaCode,
    }),
  },
  ...(side.authorizationType
    ? { authorization: { type: side.authorizationType } }
    : {}),
  ...(side.contactPhone || side.contactEmail
    ? {
        contact: {
          ...(side.contactPhone ? { phone: side.contactPhone } : {}),
          ...(side.contactEmail ? { email: side.contactEmail } : {}),
        },
      }
    : {}),
  ...(side.personName ? { person: { name: side.personName } } : {}),
  ...(side.agentName || side.agentPhone
    ? {
        agent: {
          ...(side.agentName ? { name: side.agentName } : {}),
          ...(side.agentPhone ? { phone: side.agentPhone } : {}),
        },
      }
    : {}),
  ...(side.vehicleRegistration
    ? { vehicle: { registration: side.vehicleRegistration } }
    : {}),
  ...(side.timeDuration || side.timeTimestamp || side.timeRangeStart || side.timeRangeEnd
    ? {
        time: {
          ...(side.timeDuration ? { duration: side.timeDuration } : {}),
          ...(side.timeTimestamp ? { timestamp: iso(side.timeTimestamp) } : {}),
          ...(side.timeRangeStart || side.timeRangeEnd
            ? {
                range: {
                  ...(side.timeRangeStart ? { start: iso(side.timeRangeStart) } : {}),
                  ...(side.timeRangeEnd ? { end: iso(side.timeRangeEnd) } : {}),
                },
              }
            : {}),
        },
      }
    : {}),
  ...(side.instructionCode || side.instructionShortDesc || side.instructionLongDesc
    ? {
        instructions: {
          ...(side.instructionCode ? { code: side.instructionCode } : {}),
          ...(side.instructionShortDesc
            ? { short_desc: side.instructionShortDesc }
            : {}),
          ...(side.instructionLongDesc
            ? { long_desc: side.instructionLongDesc }
            : {}),
          ...(side.instructionImages.length
            ? { images: side.instructionImages }
            : {}),
          ...(side.instructionAdditionalDescContentType ||
          side.instructionAdditionalDescUrl
            ? {
                additional_desc: {
                  ...(side.instructionAdditionalDescContentType
                    ? { content_type: side.instructionAdditionalDescContentType }
                    : {}),
                  ...(side.instructionAdditionalDescUrl
                    ? { url: side.instructionAdditionalDescUrl }
                    : {}),
                },
              }
            : {}),
        },
      }
    : {}),
});

const buildTags = (
  tags: Array<{ code: string; values: Array<{ code: string; value?: string | null }> }>,
): OndcTag[] =>
  tags.map((t) => ({
    code: t.code,
    ...(t.values.length
      ? {
          list: t.values.map((v) => ({ code: v.code, value: v.value ?? "" })),
        }
      : {}),
  }));

export const buildOndcInitOrder = (fetched: FetchedInitOrder): OndcInitOrder => {
  const order: OndcInitOrder = {
    provider: {
      id: fetched.providerId,
      ...(fetched.providerLocationIds.length
        ? { locations: fetched.providerLocationIds.map((id) => ({ id })) }
        : {}),
    },
    items: fetched.items.map((item) => ({
      id: item.itemId,
      ...(item.quantityCount !== undefined && item.quantityCount !== null
        ? { quantity: { count: item.quantityCount } }
        : {}),
      ...(item.fulfillmentId ? { fulfillment_id: item.fulfillmentId } : {}),
      ...(item.categoryId ? { category_id: item.categoryId } : {}),
      ...(item.descriptorCode ||
      item.descriptorName ||
      item.descriptorShortDesc ||
      item.descriptorLongDesc
        ? {
            descriptor: {
              ...(item.descriptorCode ? { code: item.descriptorCode } : {}),
              ...(item.descriptorName ? { name: item.descriptorName } : {}),
              ...(item.descriptorShortDesc
                ? { short_desc: item.descriptorShortDesc }
                : {}),
              ...(item.descriptorLongDesc
                ? { long_desc: item.descriptorLongDesc }
                : {}),
            },
          }
        : {}),
      ...(item.timeLabel || item.timeDuration || item.timeTimestamp
        ? {
            time: {
              ...(item.timeLabel ? { label: item.timeLabel } : {}),
              ...(item.timeDuration ? { duration: item.timeDuration } : {}),
              ...(item.timeTimestamp ? { timestamp: iso(item.timeTimestamp) } : {}),
            },
          }
        : {}),
    })),
    fulfillments: fetched.fulfillments.map((f) => ({
      id: f.fulfillmentId,
      type: f.type ?? "Delivery",
      start: buildSide(f.start),
      end: buildSide(f.end),
      ...(f.stateCode
        ? {
            state: {
              descriptor: {
                code: f.stateCode,
                ...(f.stateShortDesc ? { short_desc: f.stateShortDesc } : {}),
              },
            },
          }
        : {}),
      ...(f.awbNo ? { "@ondc/org/awb_no": f.awbNo } : {}),
      ...(f.tracking !== undefined && f.tracking !== null
        ? { tracking: f.tracking }
        : {}),
      ...(f.tags.length ? { tags: buildTags(f.tags) } : {}),
    })),
    billing: fetched.billingName
      ? {
          name: fetched.billingName,
          email: fetched.billingEmail,
          ...(fetched.billingPhone ? { phone: fetched.billingPhone } : {}),
          tax_number: fetched.billingTaxNumber,
          created_at: iso(fetched.billingCreatedAt),
          updated_at: iso(fetched.billingUpdatedAt),
          address: buildAddress({
            name: fetched.billingAddressName,
            building: fetched.billingAddressBuilding,
            locality: fetched.billingAddressLocality,
            street: fetched.billingAddressStreet,
            city: fetched.billingAddressCity,
            state: fetched.billingAddressState,
            country: fetched.billingAddressCountry,
            areaCode: fetched.billingAddressAreaCode,
          }),
        }
      : {},
    payment: fetched.paymentType
      ? {
          type: fetched.paymentType,
          collected_by: fetched.paymentCollectedBy,
          "@ondc/org/collection_amount": fetched.paymentCollectionAmount,
          ...(fetched.settlements.length
            ? {
                "@ondc/org/settlement_details": fetched.settlements.map((s) => ({
                  settlement_counterparty: s.settlementCounterparty,
                  settlement_type: s.settlementType,
                  ...(s.beneficiaryName
                    ? { beneficiary_name: s.beneficiaryName }
                    : {}),
                  ...(s.upiAddress ? { upi_address: s.upiAddress } : {}),
                  ...(s.settlementBankAccountNo
                    ? { settlement_bank_account_no: s.settlementBankAccountNo }
                    : {}),
                  ...(s.settlementIfscCode
                    ? { settlement_ifsc_code: s.settlementIfscCode }
                    : {}),
                  ...(s.settlementStatus
                    ? { settlement_status: s.settlementStatus }
                    : {}),
                  ...(s.settlementReference
                    ? { settlement_reference: s.settlementReference }
                    : {}),
                  ...(s.settlementTimestamp
                    ? { settlement_timestamp: iso(s.settlementTimestamp) }
                    : {}),
                })),
              }
            : {}),
        }
      : {},
    ...(fetched.quotePriceAmount
      ? {
          quote: {
            price: {
              currency: fetched.quotePriceCurrency,
              value: fetched.quotePriceAmount,
            },
            breakup: fetched.quoteBreakups.map((b) => ({
              "@ondc/org/item_id": b.itemId,
              "@ondc/org/title_type": b.titleType,
              price: { currency: b.priceCurrency, value: b.priceAmount },
            })),
            ...(fetched.quoteTtl ? { ttl: fetched.quoteTtl } : {}),
          },
        }
      : {}),
    ...(fetched.cancellationTerms.length
      ? {
          cancellation_terms: fetched.cancellationTerms.map((c) => ({
            fulfillment_state: {
              descriptor: {
                code: c.fulfillmentStateCode,
                short_desc: c.fulfillmentStateShortDesc,
              },
            },
            cancellation_fee: {
              percentage: c.cancellationFeePercentage,
              amount: {
                currency: c.cancellationFeeCurrency,
                value: c.cancellationFeeAmount,
              },
            },
          })),
        }
      : {}),
    ...(fetched.tags.length ? { tags: buildTags(fetched.tags) } : {}),
    ...(fetched.linkedOrder
      ? {
          "@ondc/org/linked_order": {
            items: fetched.linkedOrder.items.map((item) => ({
              descriptor: { name: item.descriptorName },
              quantity: {
                count: item.quantityCount,
                measure: {
                  unit: item.quantityMeasureUnit,
                  value: item.quantityMeasureValue,
                },
              },
              price: { currency: item.priceCurrency, value: item.priceAmount },
            })),
            provider: {
              descriptor: { name: fetched.linkedOrder.providerDescriptorName },
              address: buildAddress({
                name: fetched.linkedOrder.providerAddressName,
                building: fetched.linkedOrder.providerAddressBuilding,
                locality: fetched.linkedOrder.providerAddressLocality,
                city: fetched.linkedOrder.providerAddressCity,
                state: fetched.linkedOrder.providerAddressState,
                areaCode: fetched.linkedOrder.providerAddressAreaCode,
              }),
            },
            order: {
              id: fetched.linkedOrder.retailOrderId,
              weight: {
                unit: fetched.linkedOrder.weightUnit,
                value: fetched.linkedOrder.weightValue,
              },
              dimensions: {
                length: {
                  unit: fetched.linkedOrder.lengthUnit,
                  value: fetched.linkedOrder.lengthValue,
                },
                breadth: {
                  unit: fetched.linkedOrder.breadthUnit,
                  value: fetched.linkedOrder.breadthValue,
                },
                height: {
                  unit: fetched.linkedOrder.heightUnit,
                  value: fetched.linkedOrder.heightValue,
                },
              },
            },
          },
        }
      : {}),
    ...(fetched.orderCreatedAt ? { created_at: iso(fetched.orderCreatedAt) } : {}),
    ...(fetched.orderUpdatedAt ? { updated_at: iso(fetched.orderUpdatedAt) } : {}),
  };
  return order;
};
