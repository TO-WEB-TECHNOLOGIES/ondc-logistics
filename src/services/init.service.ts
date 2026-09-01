import { randomUUID } from "node:crypto";
import {
  mapInitRequestToOndc,
  type InitProtocolOptions,
} from "../mappers/init.mapper.js";
import type { InitRequest, InitResponse } from "../types/init/internal.js";
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
      protocol: InitProtocolOptions;
    },
  ) {}
  async createInit(request: InitRequest): Promise<InitResponse> {
    const resolved =
      await this.dependencies.repository.resolveSelection(request);
    if (resolved.status === "not_found")
      throw new Error("search option not found");
    if (resolved.status === "not_ready")
      throw new Error("search results not ready");
    if (resolved.status === "ambiguous")
      throw new Error("search option is ambiguous");
    if (resolved.status !== "ok") {
      if (resolved.status === "not_ready")
        throw new Error("search results not ready");
      if (resolved.status === "ambiguous")
        throw new Error("search option is ambiguous");
      throw new Error("search option not found");
    }
    const transactionId = resolved.selection.searchTransactionId;
    const payload = mapInitRequestToOndc(request, resolved.selection, {
      ...this.dependencies.protocol,
      transactionId,
      messageId: randomUUID(),
      timestamp: new Date().toISOString(),
    });
    const persisted = await this.dependencies.repository.create(payload);
    try {
      await this.dependencies.transport.sendInit(payload);
      await this.dependencies.repository.updateStatus(transactionId, "sent");
    } catch (error) {
      await this.dependencies.repository.updateStatus(transactionId, "failed", {
        code: "ONDC_SUBMISSION_FAILED",
        message:
          error instanceof Error ? error.message : "ONDC submission failed",
      });
      throw error;
    }
    return {
      initId: persisted.initId,
      transactionId,
      messageId: payload.context.message_id,
      status: "INIT_SENT",
    };
  }
  async handleCallback(response: OndcOnInitResponse) {
    return this.dependencies.repository.handleCallback(response);
  }
}
