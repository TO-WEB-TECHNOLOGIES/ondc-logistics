import type { DecimalInput, SearchAddress } from "../search/internal.js";
import type {
  OndcCatalogItem,
  OndcFulfillment,
  OndcProvider,
  OndcProviderLocation,
  OndcSearchRequest,
} from "../search/ondc.js";

export interface InitBilling {
  name: string;
  email: string;
  phone?: string;
  taxNumber: string;
  createdAt: string;
  updatedAt: string;
  address: SearchAddress;
}
export interface InitPayment {
  type: string;
  collectedBy: string;
  amount: DecimalInput;
  currency: string;
  settlementDetails: Record<string, unknown>[];
}
export interface InitContact {
  phone?: string;
  email?: string;
}
export interface InitRequest {
  searchId: string;
  bppId?: string;
  providerId?: string;
  itemId?: string;
  fulfillmentId?: string;
  quantity?: number;
  pickupContact: InitContact;
  deliveryContact: InitContact;
  billing: InitBilling;
  payment: InitPayment;
}
export interface ResolvedInitSelection {
  searchTransactionId: string;
  bppId: string;
  bppUri: string;
  provider: OndcProvider;
  item: OndcCatalogItem;
  fulfillment: OndcFulfillment;
  search: OndcSearchRequest;
  providerLocations: OndcProviderLocation[];
}
export interface InitResponse {
  initId: string;
  transactionId: string;
  messageId: string;
  status: "INIT_SENT";
}
