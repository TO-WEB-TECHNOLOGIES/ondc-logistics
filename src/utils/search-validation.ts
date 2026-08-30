import type { OndcOnSearchResponse } from "../types/search/ondc.js";
import type {
  SearchRequest,
  SearchLocation,
  SearchMeasurement,
  SearchSchedule,
  SearchPayload,
  SearchPayment,
  DecimalInput,
} from "../types/search/internal.js";

export class SearchValidationError extends Error {
  constructor(
    message: string,
    public readonly details?: Array<{ path: string; message: string }>,
  ) {
    super(message);
    this.name = "SearchValidationError";
  }
}
const isRecord = (value: unknown): value is Record<string, any> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const requiredString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.trim() === "")
    throw new SearchValidationError(`${field} must be a non-empty string`);
  return value;
};
const optionalString = (value: unknown, field: string) =>
  value === undefined ? undefined : requiredString(value, field);
const decimalInput = (value: unknown, field: string): DecimalInput => {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    (typeof value === "string" && value.trim() === "") ||
    (typeof value === "number" && !Number.isFinite(value))
  )
    throw new SearchValidationError(
      `${field} must be a finite number or decimal string`,
    );
  return value;
};
const measurement = (value: unknown, field: string): SearchMeasurement => {
  const x = isRecord(value)
    ? value
    : (() => {
        throw new SearchValidationError(`${field} must be an object`);
      })();
  return {
    value: decimalInput(x.value, `${field}.value`),
    unit: requiredString(x.unit, `${field}.unit`),
  };
};
const address = (value: unknown, field: string) => {
  const x = isRecord(value)
    ? value
    : (() => {
        throw new SearchValidationError(`${field} must be an object`);
      })();
  return {
    name: optionalString(x.name, `${field}.name`),
    building: optionalString(x.building, `${field}.building`),
    locality: optionalString(x.locality, `${field}.locality`),
    street: optionalString(x.street, `${field}.street`),
    city: optionalString(x.city, `${field}.city`),
    state: optionalString(x.state, `${field}.state`),
    country: optionalString(x.country, `${field}.country`),
    areaCode: requiredString(x.area_code, `${field}.area_code`),
  };
};
const location = (value: unknown, field: "start" | "end"): SearchLocation => {
  const x = isRecord(value)
    ? value
    : (() => {
        throw new SearchValidationError(
          `message.intent.fulfillment.${field} must be an object`,
        );
      })();
  const l = isRecord(x.location)
    ? x.location
    : (() => {
        throw new SearchValidationError(
          `message.intent.fulfillment.${field}.location must be an object`,
        );
      })();
  return {
    type: field,
    gps: requiredString(
      l.gps,
      `message.intent.fulfillment.${field}.location.gps`,
    ),
    address: address(
      l.address,
      `message.intent.fulfillment.${field}.location.address`,
    ),
  };
};
const parsePayload = (value: unknown): SearchPayload => {
  const x = isRecord(value)
    ? value
    : (() => {
        throw new SearchValidationError(
          "message.intent['@ondc/org/payload_details'] must be an object",
        );
      })();
  const d = isRecord(x.dimensions)
    ? x.dimensions
    : (() => {
        throw new SearchValidationError(
          "message.intent['@ondc/org/payload_details'].dimensions must be an object",
        );
      })();
  const v = isRecord(x.value)
    ? x.value
    : (() => {
        throw new SearchValidationError(
          "message.intent['@ondc/org/payload_details'].value must be an object",
        );
      })();
  return {
    weight: measurement(x.weight, "payload.weight"),
    dimensions: {
      length: measurement(d.length, "payload.dimensions.length"),
      breadth: measurement(d.breadth, "payload.dimensions.breadth"),
      height: measurement(d.height, "payload.dimensions.height"),
    },
    category: requiredString(x.category, "payload.category"),
    value: {
      amount: decimalInput(v.value, "payload.value.value"),
      currency: requiredString(v.currency, "payload.value.currency"),
    },
    dangerousGoods:
      typeof x.dangerous_goods === "boolean"
        ? x.dangerous_goods
        : (() => {
            throw new SearchValidationError(
              "payload.dangerous_goods must be a boolean",
            );
          })(),
  };
};
export const parseSearchRequest = (value: unknown): SearchRequest => {
  if (!isRecord(value))
    throw new SearchValidationError("request body must be an object");
  const c = isRecord(value.context)
    ? value.context
    : (() => {
        throw new SearchValidationError("context must be an object");
      })();
  if (c.action !== "search")
    throw new SearchValidationError("context.action must be search");
  const m = isRecord(value.message)
    ? value.message
    : (() => {
        throw new SearchValidationError("message must be an object");
      })();
  const i = isRecord(m.intent)
    ? m.intent
    : (() => {
        throw new SearchValidationError("message.intent must be an object");
      })();
  const category = isRecord(i.category)
    ? i.category
    : (() => {
        throw new SearchValidationError(
          "message.intent.category must be an object",
        );
      })();
  const provider = isRecord(i.provider)
    ? i.provider
    : (() => {
        throw new SearchValidationError(
          "message.intent.provider must be an object",
        );
      })();
  const time = isRecord(provider.time)
    ? provider.time
    : (() => {
        throw new SearchValidationError(
          "message.intent.provider.time must be an object",
        );
      })();
  const range = isRecord(time.range)
    ? time.range
    : (() => {
        throw new SearchValidationError(
          "message.intent.provider.time.range must be an object",
        );
      })();
  const f = isRecord(i.fulfillment)
    ? i.fulfillment
    : (() => {
        throw new SearchValidationError(
          "message.intent.fulfillment must be an object",
        );
      })();
  if (f.type !== "Delivery")
    throw new SearchValidationError(
      "message.intent.fulfillment.type must be Delivery",
    );
  const start = location(f.start, "start"),
    end = location(f.end, "end");
  const sa =
    isRecord(f.start) && isRecord(f.start.authorization)
      ? f.start.authorization
      : (() => {
          throw new SearchValidationError(
            "message.intent.fulfillment.start.authorization must be an object",
          );
        })();
  const ea =
    isRecord(f.end) && isRecord(f.end.authorization)
      ? f.end.authorization
      : (() => {
          throw new SearchValidationError(
            "message.intent.fulfillment.end.authorization must be an object",
          );
        })();
  if (sa.type !== "OTP" || ea.type !== "OTP")
    throw new SearchValidationError(
      "fulfillment authorization.type must be OTP",
    );
  const payment = isRecord(i.payment)
    ? i.payment
    : (() => {
        throw new SearchValidationError(
          "message.intent.payment must be an object",
        );
      })();
  if (
    !["ON-ORDER", "ON-FULFILLMENT", "POST-FULFILLMENT"].includes(payment.type)
  )
    throw new SearchValidationError("message.intent.payment.type is invalid");
  const schedule: SearchSchedule = {
    days: requiredString(time.days, "message.intent.provider.time.days"),
    rangeStart: requiredString(
      range.start,
      "message.intent.provider.time.range.start",
    ),
    rangeEnd: requiredString(
      range.end,
      "message.intent.provider.time.range.end",
    ),
  };
  const payload = parsePayload(i["@ondc/org/payload_details"]);
  const parsedTimestamp = requiredString(c.timestamp, "context.timestamp");
  if (Number.isNaN(new Date(parsedTimestamp).getTime()))
    throw new SearchValidationError(
      "context.timestamp must be a valid timestamp",
    );
  return {
    protocol: {
      domain: requiredString(c.domain, "context.domain"),
      country: requiredString(c.country, "context.country"),
      city: requiredString(c.city, "context.city"),
      coreVersion: requiredString(c.core_version, "context.core_version"),
      bapId: requiredString(c.bap_id, "context.bap_id"),
      bapUri: requiredString(c.bap_uri, "context.bap_uri"),
      transactionId:
        c.transaction_id === undefined
          ? undefined
          : requiredString(c.transaction_id, "context.transaction_id"),
      messageId:
        c.message_id === undefined
          ? undefined
          : requiredString(c.message_id, "context.message_id"),
      timestamp: parsedTimestamp,
      ttl:
        c.ttl === undefined ? undefined : requiredString(c.ttl, "context.ttl"),
    },
    categoryId: requiredString(category.id, "message.intent.category.id"),
    fulfillmentType: "Delivery",
    authorization: { startType: "OTP", endType: "OTP" },
    start,
    end,
    schedule,
    payload,
    payment: {
      type: payment.type,
      collectionAmount:
        payment["@ondc/org/collection_amount"] === undefined
          ? undefined
          : decimalInput(
              payment["@ondc/org/collection_amount"],
              "message.intent.payment.@ondc/org/collection_amount",
            ),
    },
  };
};
export const parseOnSearchResponse = (value: unknown): OndcOnSearchResponse => {
  if (!isRecord(value))
    throw new SearchValidationError("callback body must be an object");
  const context = value.context,
    message = value.message;
  if (!isRecord(context) || context.action !== "on_search")
    throw new SearchValidationError(
      "callback context.action must be on_search",
    );
  if (!isRecord(message) || !isRecord(message.catalog))
    throw new SearchValidationError("callback message.catalog is required");
  if (!Array.isArray(message.catalog["bpp/providers"]))
    throw new SearchValidationError(
      "callback message.catalog.bpp/providers must be an array",
    );
  if (
    typeof context.transaction_id !== "string" ||
    !context.transaction_id.trim()
  )
    throw new SearchValidationError(
      "callback context.transaction_id is required",
    );
  return value as OndcOnSearchResponse;
};
