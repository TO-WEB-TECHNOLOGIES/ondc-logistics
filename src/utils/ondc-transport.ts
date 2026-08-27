import { GATEWAY_URL } from "../constants/v1/appConstants.js";
import { sendOndcRequest } from "./ondc-requests.js";
import { NotImplementedError } from "./not-implemented-error.js";
import type { OndcSearchRequest } from "../types/search/ondc.js";
import type { OndcInitRequest } from "../types/init/ondc.js";

export interface OndcTransport {
  sendSearch(request: OndcSearchRequest): Promise<void>;
  sendInit(request: OndcInitRequest): Promise<void>;
}

export class UnconfiguredOndcTransport implements OndcTransport {
  async sendSearch(_request: OndcSearchRequest): Promise<void> {
    throw new NotImplementedError("ONDC transport/signing is not configured yet");
  }
  async sendInit(_request: OndcInitRequest): Promise<void> {
    throw new NotImplementedError("ONDC transport/signing is not configured yet");
  }
}

export class GatewayOndcTransport implements OndcTransport {
  constructor(private readonly gatewayUrl: string = GATEWAY_URL) {}
  async sendSearch(request: OndcSearchRequest): Promise<void> {
    await sendOndcRequest({ action: "search", payload: request as unknown as Record<string, unknown>, baseURL: this.gatewayUrl, logMeta: { transaction_id: request.context.transaction_id, message_id: request.context.message_id, bap_id: request.context.bap_id } });
  }
  async sendInit(request: OndcInitRequest): Promise<void> {
    await sendOndcRequest({ action: "init", payload: request as unknown as Record<string, unknown>, baseURL: request.context.bpp_uri, logMeta: { transaction_id: request.context.transaction_id, message_id: request.context.message_id, bap_id: request.context.bap_id, bpp_id: request.context.bpp_id } });
  }
}
