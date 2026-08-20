export interface OndcContext {
  domain: string;
  country: string;
  city: string;
  action: string;
  core_version: string;
  bap_id: string;
  bap_uri: string;
  transaction_id: string;
  message_id: string;
  timestamp: string;
  ttl?: string;
  bpp_id?: string;
  bpp_uri?: string;
}

export interface OndcAddress {
  name?: string;
  building?: string;
  locality?: string;
  street?: string;
  city?: string;
  state?: string;
  country?: string;
  area_code?: string;
}

export interface OndcLocation {
  gps: string;
  address: OndcAddress;
}

export interface OndcFulfillmentLocation {
  location: OndcLocation;
  authorization?: { type: string };
}

export interface OndcProviderSchedule {
  days?: string;
  schedule?: { holidays?: string[] };
  duration?: string;
  range?: { start?: string; end?: string };
}

export interface OndcMeasurement {
  unit: string;
  value: string | number;
}

export interface OndcPayloadDetails {
  weight: OndcMeasurement;
  dimensions: {
    length: OndcMeasurement;
    breadth: OndcMeasurement;
    height: OndcMeasurement;
  };
  category: string;
  value: { currency: string; value: string };
  dangerous_goods: boolean;
}

export interface OndcSearchIntent {
  category: { id: string };
  provider?: { time?: OndcProviderSchedule };
  fulfillment: {
    type: string;
    start: OndcFulfillmentLocation;
    end: OndcFulfillmentLocation;
  };
  payment?: {
    type: string;
    "@ondc/org/collection_amount"?: string;
  };
  "@ondc/org/payload_details"?: OndcPayloadDetails;
}

export interface OndcSearchRequest {
  context: OndcContext & { action: "search" };
  message: { intent: OndcSearchIntent };
}

export interface OndcDescriptor {
  code?: string;
  name?: string;
  short_desc?: string;
  long_desc?: string;
}

export interface OndcTagListItem { code: string; value: string }
export interface OndcTag { code: string; list?: OndcTagListItem[] }

export interface OndcCategory {
  id: string;
  time?: { label?: string; duration?: string; timestamp?: string };
}

export interface OndcFulfillment {
  id: string;
  type?: string;
  start?: { time?: { duration?: string } };
  tags?: OndcTag[];
}

export interface OndcProviderLocation {
  id: string;
  gps?: string;
  address?: OndcAddress;
}

export interface OndcCatalogItem {
  id: string;
  parent_item_id?: string;
  category_id?: string;
  fulfillment_id?: string;
  descriptor?: OndcDescriptor;
  price?: { currency?: string; value?: string };
  time?: { label?: string; duration?: string; timestamp?: string };
}

export interface OndcProvider {
  id: string;
  descriptor?: OndcDescriptor;
  categories?: OndcCategory[];
  fulfillments?: OndcFulfillment[];
  locations?: OndcProviderLocation[];
  items?: OndcCatalogItem[];
}

export interface OndcOnSearchResponse {
  context: OndcContext & { action: "on_search" };
  message: {
    catalog: {
      "bpp/descriptor"?: { name?: string; tags?: OndcTag[] };
      "bpp/providers": OndcProvider[];
    };
  };
}

export interface OndcOnSearchAckResponse {
  context: OndcContext & { action: "on_search" };
  message: { ack: { status: "ACK" | "NACK"; tags?: OndcTag[] } };
}
