import type { Request, Response } from "express";
import type { OnSearchService } from "../services/on-search.service.js";
import { NotImplementedError } from "../utils/not-implemented-error.js";
import { parseOnSearchResponse, SearchValidationError } from "../utils/search-validation.js";

export const createOnSearchController = (onSearchService: OnSearchService) =>
  async (request: Request, response: Response): Promise<void> => {
    try {
      await onSearchService.handleCallback(parseOnSearchResponse(request.body));
      response.status(200).json({ message: { ack: { status: "ACK" } } });
    } catch (error) {
      if (error instanceof SearchValidationError) {
        response.status(400).json({ error: { code: "INVALID_ON_SEARCH", message: error.message } });
        return;
      }
      if (error instanceof NotImplementedError) {
        response.status(501).json({ error: { code: "NOT_IMPLEMENTED", message: error.message } });
        return;
      }
      response.status(500).json({ error: { code: "ON_SEARCH_FAILED", message: "Unable to process callback" } });
    }
  };
