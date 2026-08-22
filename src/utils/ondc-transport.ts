import { GATEWAY_URL } from "../constants/v1/appConstants.js";
import { sendOndcRequest } from "./ondc-requests.js";
import { NotImplementedError } from "./not-implemented-error.js";
import type { OndcSearchRequest } from "../types/search/ondc.js";

export interface OndcTransport {
  sendSearch(request: OndcSearchRequest): Promise<void>;
}

export class UnconfiguredOndcTransport implements OndcTransport {
  async sendSearch(_request: OndcSearchRequest): Promise<void> {
    console.log("[ondc.transport] unconfigured transport invoked");
    throw new NotImplementedError("ONDC transport/signing is not configured yet");
  }
}

export class GatewayOndcTransport implements OndcTransport {
  constructor(private readonly gatewayUrl: string = GATEWAY_URL) {}

  async sendSearch(request: OndcSearchRequest): Promise<void> {
    console.log("[ondc.transport] sending /search", {
      gatewayUrl: this.gatewayUrl,
      transactionId: request.context.transaction_id,
      messageId: request.context.message_id,
    });
    await sendOndcRequest({
      action: "search",
      payload: request as unknown as Record<string, unknown>,
      baseURL: this.gatewayUrl,
      logMeta: {
        transaction_id: request.context.transaction_id,
        message_id: request.context.message_id,
        bap_id: request.context.bap_id,
      },
    });
  }
}

