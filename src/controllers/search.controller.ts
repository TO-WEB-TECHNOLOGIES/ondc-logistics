import type { Request, Response } from "express";
import type { SearchService } from "../services/search.service.js";
import {
  parseSearchRequest,
  SearchValidationError,
} from "../utils/search-validation.js";
import { logger, pgErrorInfo } from "../utils/logger.js";

export const createSearchController =
  (searchService: SearchService) =>
  async (request: Request, response: Response): Promise<void> => {
    console.log("[search.controller] incoming /search request");  
    try {
      const result = await searchService.createSearch(
        parseSearchRequest(request.body),
      );
      console.log("[search.controller] /search accepted", { searchId: result.searchId, transactionId: result.transactionId });
      response.status(202).json(result);
    } catch (error) {
      console.log("[search.controller] /search failed", error instanceof Error ? error.message : error);
      if (error instanceof SearchValidationError) {
        response
          .status(400)
          .json({
            error: { code: "INVALID_SEARCH_REQUEST", message: error.message },
          });
        return;
      }
      logger.error("search", "Search request failed.", pgErrorInfo(error));
      response
        .status(500)
        .json({
          error: { code: "SEARCH_FAILED", message: "Unable to create search" },
        });
    }
  };




