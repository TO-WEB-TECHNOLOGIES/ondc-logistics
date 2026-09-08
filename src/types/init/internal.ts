import type {
  DecimalInput,
  NormalizedSearchEnvelope,
  SearchAddress,
} from "../search/internal.js";
import type { OndcTag } from "../search/ondc.js";

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
export interface ResolvedInitProviderLocation {
  id: string;
  gps?: string;
  address?: SearchAddress;
}
export interface ResolvedInitItem {
  id: string;
  fulfillmentId?: string;
  categoryId?: string;
  descriptor?: {
    code?: string;
    name?: string;
    shortDesc?: string;
    longDesc?: string;
  };
  time?: { label?: string; duration?: string; timestamp?: string };
}
export interface ResolvedInitFulfillment {
  id: string;
  type?: string;
  tags: OndcTag[];
}
export interface ResolvedInitSelection {
  searchTransactionId: string;
  bppId: string;
  bppUri: string;
  provider: { id: string };
  providerLocations: ResolvedInitProviderLocation[];
  item: ResolvedInitItem;
  fulfillment: ResolvedInitFulfillment;
  searchEnvelope: NormalizedSearchEnvelope;
}
export interface InitResponse {
  initId: string;
  transactionId: string;
  messageId: string;
  status: "INIT_SENT";
}
