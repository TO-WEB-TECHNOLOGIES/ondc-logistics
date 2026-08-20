export type DecimalInput = string | number;
export type SearchStatus = "pending" | "completed" | "failed";
export type SearchLocationType = "start" | "end";

export interface SearchAddress {
  name?: string;
  building?: string;
  locality?: string;
  street?: string;
  city?: string;
  state?: string;
  country?: string;
  areaCode: string;
}

export interface SearchLocation {
  type: SearchLocationType;
  gps: string;
  address: SearchAddress;
}

export interface SearchAuthorization {
  startType: string;
  endType: string;
}

export interface SearchSchedule {
  days: string;
  duration?: string;
  rangeStart?: string;
  rangeEnd?: string;
  holidays?: string[];
}

export interface SearchMeasurement {
  value: DecimalInput;
  unit: string;
}

export interface SearchDimensions {
  length: SearchMeasurement;
  breadth: SearchMeasurement;
  height: SearchMeasurement;
}

export interface SearchPayload {
  weight: SearchMeasurement;
  dimensions: SearchDimensions;
  category: string;
  value: { amount: DecimalInput; currency: string };
  dangerousGoods: boolean;
}

export interface SearchPayment {
  type: string;
  collectionAmount?: DecimalInput;
  currency?: string;
}

export interface SearchRequest {
  categoryId: string;
  fulfillmentType: string;
  authorization: SearchAuthorization;
  start: SearchLocation;
  end: SearchLocation;
  schedule?: SearchSchedule;
  payload?: SearchPayload;
  payment?: SearchPayment;
}

export interface SearchResponse {
  searchId: string;
  transactionId: string;
  status: "pending";
}

export interface NormalizedProviderResult {
  providerId: string;
  name?: string;
  shortDescription?: string;
  longDescription?: string;
  categories: Array<{
    categoryId: string;
    timeLabel?: string;
    duration?: string;
    timestamp?: string;
  }>;
  fulfillments: Array<{
    fulfillmentId: string;
    type?: string;
    pickupDuration?: string;
    motorableDistance?: DecimalInput;
    motorableDistanceUnit?: string;
  }>;
  locations: Array<{
    locationId: string;
    gps?: string;
    street?: string;
    city?: string;
    state?: string;
    areaCode?: string;
  }>;
  items: Array<{
    catalogItemId: string;
    parentItemId?: string;
    categoryId?: string;
    fulfillmentId?: string;
    descriptorCode?: string;
    name?: string;
    shortDescription?: string;
    longDescription?: string;
    tatLabel?: string;
    tatDuration?: string;
    tatTimestamp?: string;
    priceAmount?: DecimalInput;
    priceCurrency?: string;
  }>;
  staticTerms?: {
    staticTermsUrl?: string;
    staticTermsNewUrl?: string;
    effectiveDate?: string;
    version?: string;
  };
}

export interface SearchResultEvent {
  event: "search_result";
  searchId: string;
  provider: NormalizedProviderResult;
}

export interface SearchErrorEvent {
  event: "search_error";
  searchId: string;
  code: string;
  message: string;
}

export interface SearchCompletedEvent {
  event: "search_completed";
  searchId: string;
  reason: "timeout" | "transport_error" | "completed";
}

export type SearchSseEvent = SearchResultEvent | SearchErrorEvent | SearchCompletedEvent;
