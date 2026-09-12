import { GATEWAY_URL } from "../constants/v1/appConstants.js";
import { sendOndcRequest } from "./ondc-requests.js";
import { NotImplementedError } from "./not-implemented-error.js";
import type { OndcSearchRequest } from "../types/search/ondc.js";
import type { OndcInitRequest } from "../types/init/ondc.js";
import type { OndcConfirmRequest } from "../types/confirm/ondc.js";
import type { OndcUpdateRequest } from "../types/update/ondc.js";
import type { OndcStatusRequest } from "../types/status/ondc.js";
import type { OndcTrackRequest } from "../types/track/ondc.js";
import type { OndcCancelRequest } from "../types/cancel/ondc.js";
export interface OndcTransport {
  sendSearch(request: OndcSearchRequest): Promise<void>;
  sendInit(request: OndcInitRequest): Promise<void>;
  sendConfirm(request: OndcConfirmRequest): Promise<void>;
  sendUpdate(request: OndcUpdateRequest): Promise<void>;
  sendStatus(request: OndcStatusRequest): Promise<void>;
  sendTrack(request: OndcTrackRequest): Promise<void>;
  sendCancel(request: OndcCancelRequest): Promise<void>;
}
export class UnconfiguredOndcTransport implements OndcTransport {
  async sendSearch(_request: OndcSearchRequest) {
    throw new NotImplementedError(
      "ONDC transport/signing is not configured yet",
    );
  }
  async sendInit(_request: OndcInitRequest) {
    throw new NotImplementedError(
      "ONDC transport/signing is not configured yet",
    );
  }
  async sendConfirm(_request: OndcConfirmRequest) {
    throw new NotImplementedError(
      "ONDC transport/signing is not configured yet",
    );
  }
  async sendUpdate(_request: OndcUpdateRequest) {
    throw new NotImplementedError(
      "ONDC transport/signing is not configured yet",
    );
  }
  async sendStatus(_request: OndcStatusRequest) {
    throw new NotImplementedError(
      "ONDC transport/signing is not configured yet",
    );
  }
  async sendTrack(_request: OndcTrackRequest) {
    throw new NotImplementedError(
      "ONDC transport/signing is not configured yet",
    );
  }
  async sendCancel(_request: OndcCancelRequest) {
    throw new NotImplementedError(
      "ONDC transport/signing is not configured yet",
    );
  }
}
export class GatewayOndcTransport implements OndcTransport {
  constructor(private readonly gatewayUrl: string = GATEWAY_URL) {}
  async sendSearch(request: OndcSearchRequest) {
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
  async sendInit(request: OndcInitRequest) {
    await sendOndcRequest({
      action: "init",
      payload: request as unknown as Record<string, unknown>,
      baseURL: request.context.bpp_uri,
      logMeta: {
        transaction_id: request.context.transaction_id,
        message_id: request.context.message_id,
        bap_id: request.context.bap_id,
        bpp_id: request.context.bpp_id,
      },
    });
  }
  async sendConfirm(request: OndcConfirmRequest) {
    await sendOndcRequest({
      action: "confirm",
      payload: request as unknown as Record<string, unknown>,
      baseURL: request.context.bpp_uri,
      logMeta: {
        transaction_id: request.context.transaction_id,
        message_id: request.context.message_id,
        bap_id: request.context.bap_id,
        bpp_id: request.context.bpp_id,
        order_id: request.message.order.id,
      },
    });
  }
  async sendUpdate(request: OndcUpdateRequest) {
    await sendOndcRequest({
      action: "update",
      payload: request as unknown as Record<string, unknown>,
      baseURL: request.context.bpp_uri,
      logMeta: {
        transaction_id: request.context.transaction_id,
        message_id: request.context.message_id,
        bap_id: request.context.bap_id,
        bpp_id: request.context.bpp_id,
        order_id: request.message.order.id,
      },
    });
  }
  async sendStatus(request: OndcStatusRequest) {
    await sendOndcRequest({
      action: "status",
      payload: request as unknown as Record<string, unknown>,
      baseURL: request.context.bpp_uri,
      logMeta: {
        transaction_id: request.context.transaction_id,
        message_id: request.context.message_id,
        bap_id: request.context.bap_id,
        bpp_id: request.context.bpp_id,
        order_id: request.message.order_id,
      },
    });
  }
  async sendTrack(request: OndcTrackRequest) {
    await sendOndcRequest({
      action: "track",
      payload: request as unknown as Record<string, unknown>,
      baseURL: request.context.bpp_uri,
      logMeta: {
        transaction_id: request.context.transaction_id,
        message_id: request.context.message_id,
        bap_id: request.context.bap_id,
        bpp_id: request.context.bpp_id,
        order_id: request.message.order_id,
      },
    });
  }
  async sendCancel(request: OndcCancelRequest) {
    await sendOndcRequest({
      action: "cancel",
      payload: request as unknown as Record<string, unknown>,
      baseURL: request.context.bpp_uri,
      logMeta: {
        transaction_id: request.context.transaction_id,
        message_id: request.context.message_id,
        bap_id: request.context.bap_id,
        bpp_id: request.context.bpp_id,
        order_id: request.message.order_id,
      },
    });
  }
}
