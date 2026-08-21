import { GATEWAY_URL } from "../constants/v1/appConstants.js";
import { sendOndcRequest } from "./ondc-requests.js";
import { NotImplementedError } from "./not-implemented-error.js";
import type { OndcSearchRequest } from "../types/search/ondc.js";

export interface OndcTransport {
  sendSearch(request: OndcSearchRequest): Promise<void>;
}

export class UnconfiguredOndcTransport implements OndcTransport {
  async sendSearch(_request: OndcSearchRequest): Promise<void> {
    throw new NotImplementedError("ONDC transport/signing is not configured yet");
  }
}

/** Production adapter around the shared ONDC signing + HTTP utility. */
export class GatewayOndcTransport implements OndcTransport {
  constructor(private readonly gatewayUrl: string = GATEWAY_URL) {}

  async sendSearch(request: OndcSearchRequest): Promise<void> {
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
