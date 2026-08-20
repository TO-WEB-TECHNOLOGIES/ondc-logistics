import { randomUUID } from "node:crypto";
import { mapSearchRequestToOndc, type SearchProtocolOptions } from "../mappers/search.mapper.js";
import type { SearchRequest, SearchResponse } from "../types/search/internal.js";
import { NotImplementedError } from "../utils/not-implemented-error.js";
import type { OndcTransport } from "../utils/ondc-transport.js";

export interface SearchServiceDependencies {
  transport: OndcTransport;
  protocol: Omit<SearchProtocolOptions, "transactionId" | "messageId" | "timestamp">;
}

export class SearchService {
  constructor(private readonly dependencies: SearchServiceDependencies) {}

  async createSearch(_request: SearchRequest): Promise<SearchResponse> {
    throw new NotImplementedError(
      "Search persistence and outbound ONDC orchestration are not implemented yet",
    );
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
