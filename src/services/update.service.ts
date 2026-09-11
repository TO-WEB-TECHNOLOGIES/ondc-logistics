import { randomUUID } from "node:crypto";
import { buildUpdateOrder, buildUpdatePayload } from "../mappers/update/index.js";
import type { UpdateRepository } from "../repositories/update.repository.js";
import type { UpdateRequest, UpdateResponse } from "../types/update/internal.js";
import type { OndcOnUpdateResponse } from "../types/update/ondc.js";
import type { OndcTransport } from "../utils/ondc-transport.js";
import {
  UpdateValidationError,
  validateUpdatePayload,
} from "../utils/update-validation.js";

export interface UpdateProtocol {
  domain: string;
  country: string;
  city: string;
  coreVersion: string;
  bapId: string;
  bapUri: string;
}

export class UpdateService {
  constructor(
    private readonly dependencies: {
      transport: OndcTransport;
      repository: UpdateRepository;
      protocol: UpdateProtocol;
    },
  ) {}

  async createUpdate(input: UpdateRequest): Promise<UpdateResponse> {
    console.log("[update.service] createUpdate invoked", {
      orderId: input.orderId,
      fulfillmentId: input.fulfillmentId,
      updateType: input.updateType,
    });
    const row = await this.dependencies.repository.loadOrder(input.orderId);
    if (!row)
      throw new UpdateValidationError("order not found", "orderId");
    if (row.fulfillmentId !== input.fulfillmentId)
      throw new UpdateValidationError(
        "does not match the order's fulfillment",
        "fulfillmentId",
      );
    if (!row.bppId || !row.bppUri)
      throw new UpdateValidationError(
        "order is missing bpp routing information",
        "orderId",
      );

    const tags = await this.dependencies.repository.loadFulfillmentTags(input.orderId);
    const order = buildUpdateOrder(row, input, tags);
    const transactionId = input.context?.transaction_id ?? row.transactionId;
    const messageId = input.context?.message_id ?? randomUUID();
    const now = new Date().toISOString();
    const { protocol } = this.dependencies;
    const payload = buildUpdatePayload({
      order,
      context: {
        domain: protocol.domain,
        country: protocol.country,
        city: protocol.city,
        core_version: protocol.coreVersion,
        bap_id: protocol.bapId,
        bap_uri: protocol.bapUri,
      },
      bppId: row.bppId,
      bppUri: row.bppUri,
      transactionId,
      messageId,
      now,
    });
    validateUpdatePayload(payload);
    console.log(
      "[update.service] final ONDC /update payload",
      JSON.stringify(payload, null, 2),
    );

    const created = await this.dependencies.repository.create(
      payload,
      input.updateType,
    );
    if (!created) {
      console.log("[update.service] idempotent /update retry", {
        orderId: input.orderId,
        transactionId,
        messageId,
      });
      return {
        orderId: input.orderId,
        transactionId,
        messageId,
        updateType: input.updateType,
        status: "UPDATE_SENT",
      };
    }

    try {
      await this.dependencies.transport.sendUpdate(payload);
      await this.dependencies.repository.updateStatus(
        transactionId,
        messageId,
        "sent",
      );
    } catch (error) {
      await this.dependencies.repository.updateStatus(
        transactionId,
        messageId,
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
      orderId: input.orderId,
      transactionId,
      messageId,
      updateType: input.updateType,
      status: "UPDATE_SENT",
    };
  }

  async handleCallback(response: OndcOnUpdateResponse) {
    console.log("[update.service] handling /on_update", {
      transactionId: response.context.transaction_id,
      messageId: response.context.message_id,
    });
    return this.dependencies.repository.handleCallback(response);
  }
}
