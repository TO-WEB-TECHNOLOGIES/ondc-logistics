import { randomUUID } from "node:crypto";
import { mapSearchRequestToOndc, type SearchProtocolOptions } from "../mappers/search.mapper.js";
import type { SearchRequest, SearchResponse } from "../types/search/internal.js";
import type { OndcTransport } from "../utils/ondc-transport.js";
import type { SearchRepository } from "../repositories/search.repository.js";

export interface SearchServiceDependencies {
  transport: OndcTransport;
  repository: SearchRepository;
  protocol: Omit<SearchProtocolOptions, "transactionId" | "messageId" | "timestamp">;
}

export class SearchService {
  constructor(private readonly dependencies: SearchServiceDependencies) {}

  async createSearch(request: SearchRequest): Promise<SearchResponse> {
    const payload = this.createOndcRequest(request);
    const persisted = await this.dependencies.repository.createSearch({ request, payload });
    try {
      await this.dependencies.transport.sendSearch(payload);
      await this.dependencies.repository.updateTransactionStatus(payload.context.transaction_id, "sent");
    } catch (error) {
      await this.dependencies.repository.updateTransactionStatus(payload.context.transaction_id, "failed", {
        code: "ONDC_SUBMISSION_FAILED", message: error instanceof Error ? error.message : "ONDC submission failed",
      });
      throw error;
    }
    return { searchId: persisted.searchId, transactionId: payload.context.transaction_id, messageId: payload.context.message_id, status: "SEARCH_SENT" };
  }

  createOndcRequest(request: SearchRequest) {
    return mapSearchRequestToOndc(request, {
      ...this.dependencies.protocol,
      transactionId: randomUUID(),
      messageId: randomUUID(),
      timestamp: new Date().toISOString(),
    });
  }
}
