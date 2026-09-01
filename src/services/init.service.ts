import { randomUUID } from "node:crypto";
import type { InitResponse } from "../types/init/internal.js";
import type {
  OndcInitRequest,
  OndcOnInitResponse,
} from "../types/init/ondc.js";
import type { OndcTransport } from "../utils/ondc-transport.js";
import type { InitRepository } from "../repositories/init.repository.js";
export class InitService {
  constructor(
    private readonly dependencies: {
      transport: OndcTransport;
      repository: InitRepository;
    },
  ) {}
  async createInit(payload: OndcInitRequest): Promise<InitResponse> {
    console.log("[init.service] createInit invoked", {
      transactionId: payload.context.transaction_id,
      messageId: payload.context.message_id,
      bppId: payload.context.bpp_id,
      providerId: payload.message.order.provider.id,
      itemCount: payload.message.order.items.length,
      fulfillmentCount: payload.message.order.fulfillments.length,
    });
    const persisted = await this.dependencies.repository.create(payload);
    try {
      console.log("[init.service] sending /init to transport", {
        transactionId: payload.context.transaction_id,
        bppUri: payload.context.bpp_uri,
      });
      await this.dependencies.transport.sendInit(payload);
      await this.dependencies.repository.updateStatus(
        payload.context.transaction_id,
        "sent",
      );
      console.log("[init.service] /init sent", {
        transactionId: payload.context.transaction_id,
      });
    } catch (error) {
      console.log("[init.service] /init failed", {
        transactionId: payload.context.transaction_id,
        error: error instanceof Error ? error.message : error,
      });
      await this.dependencies.repository.updateStatus(
        payload.context.transaction_id,
        "failed",
        {
          code: "ONDC_SUBMISSION_FAILED",
          message:
            error instanceof Error ? error.message : "ONDC submission failed",
        },
      );
      throw error;
    }
    return {
      initId: persisted.initId,
      transactionId: payload.context.transaction_id,
      messageId: payload.context.message_id,
      status: "INIT_SENT",
    };
  }
  async handleCallback(response: OndcOnInitResponse) {
    console.log("[init.service] handling /on_init", {
      transactionId: response.context.transaction_id,
      messageId: response.context.message_id,
    });
    return this.dependencies.repository.handleCallback(response);
  }
}
