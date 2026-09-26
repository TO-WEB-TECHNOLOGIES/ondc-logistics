import { contextBaseFromProtocol } from "../utils/ondc-context.js";
import {
  resolveTransactionProtocol,
  type TransactionContextLoader,
} from "../repositories/transaction-context.js";
import { randomUUID } from "node:crypto";
import { buildTrackPayload } from "../mappers/track.mapper.js";
import type { TrackRepository } from "../repositories/track.repository.js";
import type { TrackRequest, TrackResponse } from "../types/track/internal.js";
import type { OndcOnTrackResponse } from "../types/track/ondc.js";
import type { OndcTransport } from "../utils/ondc-transport.js";
import {
  TrackValidationError,
  validateTrackPayload,
} from "../utils/track-validation.js";
import type { CallbackStream } from "../utils/streams/callback-stream.js";

export interface TrackProtocol {
  domain: string;
  country: string;
  city: string;
  coreVersion: string;
  bapId: string;
  bapUri: string;
}

export class TrackService {
  constructor(
    private readonly dependencies: {
      transport: OndcTransport;
      repository: TrackRepository;
      protocol: TrackProtocol;
      loadTransactionContext: TransactionContextLoader;
    },
  ) {}

  async createTrack(input: TrackRequest): Promise<TrackResponse> {
    console.log("[track.service] createTrack invoked", { orderId: input.orderId });
    const row = await this.dependencies.repository.loadOrder(input.orderId);
    if (!row) throw new TrackValidationError("order not found", "orderId");
    if (!row.bppId || !row.bppUri)
      throw new TrackValidationError(
        "order is missing bpp routing information",
        "orderId",
      );

    const transactionId = input.context?.transaction_id ?? row.transactionId;
    const messageId = input.context?.message_id ?? randomUUID();
    const now = new Date().toISOString();
    const protocol = await resolveTransactionProtocol(
      this.dependencies.loadTransactionContext,
      transactionId,
      this.dependencies.protocol,
    );
    const payload = buildTrackPayload({
      orderId: input.orderId,
      context: contextBaseFromProtocol(protocol),
      bppId: row.bppId,
      bppUri: row.bppUri,
      transactionId,
      messageId,
      now,
    });
    validateTrackPayload(payload);
    console.log(
      "[track.service] final ONDC /track payload",
      JSON.stringify(payload, null, 2),
    );

    const created = await this.dependencies.repository.create(payload);
    if (!created) {
      console.log("[track.service] idempotent /track retry", {
        orderId: input.orderId,
        transactionId,
        messageId,
      });
      return { orderId: input.orderId, transactionId, messageId, status: "TRACK_SENT" };
    }

    try {
      await this.dependencies.transport.sendTrack(payload);
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

    return { orderId: input.orderId, transactionId, messageId, status: "TRACK_SENT" };
  }

  async handleCallback(response: OndcOnTrackResponse, stream?: CallbackStream) {
    console.log("[track.service] handling /on_track", {
      transactionId: response.context.transaction_id,
      messageId: response.context.message_id,
    });
    return this.dependencies.repository.handleCallback(response, stream);
  }
}
