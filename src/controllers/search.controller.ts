import type { Request, Response } from "express";
import type { SearchService } from "../services/search.service.js";
import { NotImplementedError } from "../utils/not-implemented-error.js";
import { parseSearchRequest, SearchValidationError } from "../utils/search-validation.js";

export const createSearchController = (searchService: SearchService) =>
  async (request: Request, response: Response): Promise<void> => {
    try {
      const result = await searchService.createSearch(parseSearchRequest(request.body));
      response.status(202).json(result);
    } catch (error) {
      if (error instanceof SearchValidationError) {
        response.status(400).json({ error: { code: "INVALID_SEARCH_REQUEST", message: error.message } });
        return;
      }
      if (error instanceof NotImplementedError) {
        response.status(501).json({ error: { code: "NOT_IMPLEMENTED", message: error.message } });
        return;
      }
      response.status(500).json({ error: { code: "SEARCH_FAILED", message: "Unable to create search" } });
    }
  };
