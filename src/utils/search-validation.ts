import type { OndcOnSearchResponse } from "../types/search/ondc.js";
import type {
  DecimalInput,
  SearchDimensions,
  SearchLocation,
  SearchMeasurement,
  SearchPayload,
  SearchPayment,
  SearchRequest,
  SearchSchedule,
} from "../types/search/internal.js";

export class SearchValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchValidationError";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requiredString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new SearchValidationError(`${field} must be a non-empty string`);
  }
  return value;
};

const optionalString = (value: unknown, field: string): string | undefined =>
  value === undefined ? undefined : requiredString(value, field);

const decimalInput = (value: unknown, field: string): DecimalInput => {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    (typeof value === "string" && value.trim() === "") ||
    (typeof value === "number" && !Number.isFinite(value))
  ) {
    throw new SearchValidationError(`${field} must be a finite number or decimal string`);
  }
  return value;
};

const parseMeasurement = (value: unknown, field: string): SearchMeasurement => {
  if (!isRecord(value)) throw new SearchValidationError(`${field} must be an object`);
  return {
    value: decimalInput(value.value, `${field}.value`),
    unit: requiredString(value.unit, `${field}.unit`),
  };
};

const parseLocation = (value: unknown, field: "start" | "end"): SearchLocation => {
  if (!isRecord(value)) throw new SearchValidationError(`${field} must be an object`);
  if (!isRecord(value.address)) {
    throw new SearchValidationError(`${field}.address must be an object`);
  }
  const address = value.address;
  return {
    type: field,
    gps: requiredString(value.gps, `${field}.gps`),
    address: {
      name: optionalString(address.name, `${field}.address.name`),
      building: optionalString(address.building, `${field}.address.building`),
      locality: optionalString(address.locality, `${field}.address.locality`),
      street: optionalString(address.street, `${field}.address.street`),
      city: optionalString(address.city, `${field}.address.city`),
      state: optionalString(address.state, `${field}.address.state`),
      country: optionalString(address.country, `${field}.address.country`),
      areaCode: requiredString(address.areaCode, `${field}.address.areaCode`),
    },
  };
};

const parseSchedule = (value: unknown): SearchSchedule => {
  if (!isRecord(value)) throw new SearchValidationError("schedule must be an object");
  const holidays = value.holidays;
  if (holidays !== undefined && (!Array.isArray(holidays) || holidays.some((item) => typeof item !== "string"))) {
    throw new SearchValidationError("schedule.holidays must be an array of strings");
  }
  return {
    days: requiredString(value.days, "schedule.days"),
    duration: optionalString(value.duration, "schedule.duration"),
    rangeStart: optionalString(value.rangeStart, "schedule.rangeStart"),
    rangeEnd: optionalString(value.rangeEnd, "schedule.rangeEnd"),
    holidays: holidays as string[] | undefined,
  };
};

const parsePayload = (value: unknown): SearchPayload => {
  if (!isRecord(value)) throw new SearchValidationError("payload must be an object");
  if (!isRecord(value.dimensions)) throw new SearchValidationError("payload.dimensions must be an object");
  const dimensions = value.dimensions;
  if (!isRecord(value.value)) throw new SearchValidationError("payload.value must be an object");
  return {
    weight: parseMeasurement(value.weight, "payload.weight"),
    dimensions: {
      length: parseMeasurement(dimensions.length, "payload.dimensions.length"),
      breadth: parseMeasurement(dimensions.breadth, "payload.dimensions.breadth"),
      height: parseMeasurement(dimensions.height, "payload.dimensions.height"),
    } satisfies SearchDimensions,
    category: requiredString(value.category, "payload.category"),
    value: {
      amount: decimalInput(value.value.amount, "payload.value.amount"),
      currency: requiredString(value.value.currency, "payload.value.currency"),
    },
    dangerousGoods: (() => {
      if (typeof value.dangerousGoods !== "boolean") {
        throw new SearchValidationError("payload.dangerousGoods must be a boolean");
      }
      return value.dangerousGoods;
    })(),
  };
};

const parsePayment = (value: unknown): SearchPayment => {
  if (!isRecord(value)) throw new SearchValidationError("payment must be an object");
  return {
    type: requiredString(value.type, "payment.type"),
    collectionAmount:
      value.collectionAmount === undefined
        ? undefined
        : decimalInput(value.collectionAmount, "payment.collectionAmount"),
    currency: optionalString(value.currency, "payment.currency"),
  };
};

export const parseSearchRequest = (value: unknown): SearchRequest => {
  if (!isRecord(value)) throw new SearchValidationError("request body must be an object");
  if (!isRecord(value.authorization)) {
    throw new SearchValidationError("authorization must be an object");
  }
  return {
    categoryId: requiredString(value.categoryId, "categoryId"),
    fulfillmentType: requiredString(value.fulfillmentType, "fulfillmentType"),
    authorization: {
      startType: requiredString(value.authorization.startType, "authorization.startType"),
      endType: requiredString(value.authorization.endType, "authorization.endType"),
    },
    start: parseLocation(value.start, "start"),
    end: parseLocation(value.end, "end"),
    schedule: value.schedule === undefined ? undefined : parseSchedule(value.schedule),
    payload: value.payload === undefined ? undefined : parsePayload(value.payload),
    payment: value.payment === undefined ? undefined : parsePayment(value.payment),
  };
};

export const parseOnSearchResponse = (value: unknown): OndcOnSearchResponse => {
  if (!isRecord(value)) throw new SearchValidationError("callback body must be an object");
  const context = value.context;
  const message = value.message;
  if (!isRecord(context) || context.action !== "on_search") {
    throw new SearchValidationError("callback context.action must be on_search");
  }
  if (!isRecord(message) || !isRecord(message.catalog)) {
    throw new SearchValidationError("callback message.catalog is required");
  }
  if (!Array.isArray(message.catalog["bpp/providers"])) {
    throw new SearchValidationError("callback message.catalog.bpp/providers must be an array");
  }
  if (typeof context.transaction_id !== "string" || context.transaction_id.trim() === "") {
    throw new SearchValidationError("callback context.transaction_id is required");
  }
  return value as unknown as OndcOnSearchResponse;
};
