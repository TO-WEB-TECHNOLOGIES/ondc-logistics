import { NotImplementedError } from "../utils/not-implemented-error.js";
import type { OndcOnSearchResponse } from "../types/search/ondc.js";

export class OnSearchService {
  async handleCallback(_response: OndcOnSearchResponse): Promise<void> {
    throw new NotImplementedError(
      "ONDC callback correlation, persistence, and SSE publication are not implemented yet",
    );
  }
}
