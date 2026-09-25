import { randomUUID } from "node:crypto";
import { buildStatusPayload } from "../mappers/status.mapper.js";
import type { StatusRepository } from "../repositories/status.repository.js";
import type { StatusRequest, StatusResponse } from "../types/status/internal.js";
import type { OndcOnStatusResponse } from "../types/status/ondc.js";
import type { OndcTransport } from "../utils/ondc-transport.js";
import {
  StatusValidationError,
  validateStatusPayload,
} from "../utils/status-validation.js";
import type { CallbackStream } from "../utils/streams/callback-stream.js";

export interface StatusProtocol {
  domain: string;
  country: string;
  city: string;
  coreVersion: string;
  bapId: string;
  bapUri: string;
}

export class StatusService {
  constructor(
    private readonly dependencies: {
      transport: OndcTransport;
      repository: StatusRepository;
      protocol: StatusProtocol;
    },
  ) {}

  async createStatus(input: StatusRequest): Promise<StatusResponse> {
    console.log("[status.service] createStatus invoked", {
      orderId: input.orderId,
    });
    const row = await this.dependencies.repository.loadOrder(input.orderId);
    if (!row) throw new StatusValidationError("order not found", "orderId");
    if (!row.bppId || !row.bppUri)
      throw new StatusValidationError(
        "order is missing bpp routing information",
        "orderId",
      );

    const transactionId = input.context?.transaction_id ?? row.transactionId;
    const messageId = input.context?.message_id ?? randomUUID();
    const now = new Date().toISOString();
    const { protocol } = this.dependencies;
    const payload = buildStatusPayload({
      orderId: input.orderId,
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
    validateStatusPayload(payload);
    console.log(
      "[status.service] final ONDC /status payload",
      JSON.stringify(payload, null, 2),
    );

    const created = await this.dependencies.repository.create(payload);
    if (!created) {
      console.log("[status.service] idempotent /status retry", {
        orderId: input.orderId,
        transactionId,
        messageId,
      });
      return { orderId: input.orderId, transactionId, messageId, status: "STATUS_SENT" };
    }

    try {
      await this.dependencies.transport.sendStatus(payload);
      await this.dependencies.repository.updateStatus(transactionId, messageId, "sent");
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

    return { orderId: input.orderId, transactionId, messageId, status: "STATUS_SENT" };
  }

  async handleCallback(response: OndcOnStatusResponse, stream?: CallbackStream) {
    console.log("[status.service] handling /on_status", {
      transactionId: response.context.transaction_id,
      messageId: response.context.message_id,
    });
    return this.dependencies.repository.handleCallback(response, stream);
  }
}
