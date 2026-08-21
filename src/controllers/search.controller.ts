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
    try {
      const result = await searchService.createSearch(
        parseSearchRequest(request.body),
      );
      response.status(202).json(result);
    } catch (error) {
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
