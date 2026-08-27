import { randomUUID } from "node:crypto";
import type { InitRequest, InitResponse } from "../types/init/internal.js";
import type { OndcTransport } from "../utils/ondc-transport.js";
import type { InitRepository } from "../repositories/init.repository.js";
export class InitService {
  constructor(private readonly dependencies: { transport: OndcTransport; repository: InitRepository; protocol: any }) {}
  async createInit(input: InitRequest): Promise<InitResponse> {
    const ids = { transactionId: randomUUID(), messageId: randomUUID(), timestamp: new Date().toISOString() };
    const prepared = await this.dependencies.repository.prepare(input, ids, this.dependencies.protocol);
    const persisted = await this.dependencies.repository.create(prepared.payload, prepared.parentTransactionId);
    try { await this.dependencies.transport.sendInit(prepared.payload); await this.dependencies.repository.updateStatus(ids.transactionId, "sent"); }
    catch (error) { await this.dependencies.repository.updateStatus(ids.transactionId, "failed", { code: "ONDC_SUBMISSION_FAILED", message: error instanceof Error ? error.message : "ONDC submission failed" }); throw error; }
    return { initId: persisted.initId, transactionId: ids.transactionId, messageId: ids.messageId, status: "INIT_SENT" };
  }
  async handleCallback(response: any) { return this.dependencies.repository.handleCallback(response); }
}
