import { randomUUID } from "node:crypto";
import { buildCancelPayload } from "../mappers/cancel.mapper.js";
import type { CancelRepository } from "../repositories/cancel.repository.js";
import type { CancelRequest, CancelResponse } from "../types/cancel/internal.js";
import type { OndcOnCancelResponse } from "../types/cancel/ondc.js";
import type { OndcTransport } from "../utils/ondc-transport.js";
import {
  CancelValidationError,
  validateCancelPayload,
} from "../utils/cancel-validation.js";
import type { CallbackStream } from "../utils/streams/callback-stream.js";

export interface CancelProtocol {
  domain: string;
  country: string;
  city: string;
  coreVersion: string;
  bapId: string;
  bapUri: string;
}

export class CancelService {
  constructor(
    private readonly dependencies: {
      transport: OndcTransport;
      repository: CancelRepository;
      protocol: CancelProtocol;
    },
  ) {}

  async createCancel(input: CancelRequest): Promise<CancelResponse> {
    console.log("[cancel.service] createCancel invoked", {
      orderId: input.orderId,
      cancellationReasonId: input.cancellationReasonId,
    });
    const row = await this.dependencies.repository.loadOrder(input.orderId);
    if (!row) throw new CancelValidationError("order not found", "orderId");
    if (!row.bppId || !row.bppUri)
      throw new CancelValidationError(
        "order is missing bpp routing information",
        "orderId",
      );
    if (row.state === "Cancelled")
      throw new CancelValidationError("order is already cancelled", "orderId");

    const transactionId = input.context?.transaction_id ?? row.transactionId;
    const messageId = input.context?.message_id ?? randomUUID();
    const now = new Date().toISOString();
    const { protocol } = this.dependencies;
    const payload = buildCancelPayload({
      orderId: input.orderId,
      cancellationReasonId: input.cancellationReasonId,
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
    validateCancelPayload(payload);
    console.log(
      "[cancel.service] final ONDC /cancel payload",
      JSON.stringify(payload, null, 2),
    );

    const created = await this.dependencies.repository.create(payload);
    if (!created) {
      console.log("[cancel.service] idempotent /cancel retry", {
        orderId: input.orderId,
        transactionId,
        messageId,
      });
      return { orderId: input.orderId, transactionId, messageId, status: "CANCEL_SENT" };
    }

    try {
      await this.dependencies.transport.sendCancel(payload);
      await this.dependencies.repository.updateStatus(
        transactionId,
        messageId,
        input.orderId,
        "sent",
      );
    } catch (error) {
      await this.dependencies.repository.updateStatus(
        transactionId,
        messageId,
        input.orderId,
        "failed",
        {
          code: "ONDC_SUBMISSION_FAILED",
          message:
            error instanceof Error ? error.message : "ONDC submission failed",
        },
      );
      throw error;
    }

    return { orderId: input.orderId, transactionId, messageId, status: "CANCEL_SENT" };
  }

  async handleCallback(response: OndcOnCancelResponse, stream?: CallbackStream) {
    console.log("[cancel.service] handling /on_cancel", {
      transactionId: response.context.transaction_id,
      messageId: response.context.message_id,
    });
    return this.dependencies.repository.handleCallback(response, stream);
  }
}
