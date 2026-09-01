import type { DecimalInput, SearchAddress } from "../search/internal.js";
export interface InitBilling {
  name: string;
  email?: string;
  phone?: string;
  address: SearchAddress;
}
export interface InitPayment {
  type: string;
  collectedBy?: string;
  amount?: DecimalInput;
  currency?: string;
  settlementDetails?: Record<string, unknown>[];
}
export interface InitRequest {
  searchId: string;
  bppId: string;
  providerId: string;
  itemId: string;
  fulfillmentId: string;
  quantity?: number;
  billing: InitBilling;
  payment: InitPayment;
}
export interface InitResponse {
  initId: string;
  transactionId: string;
  messageId: string;
  status: "INIT_SENT";
}
