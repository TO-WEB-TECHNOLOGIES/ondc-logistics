import type { Request, Response } from "express";
import type { OnSearchService } from "../services/on-search.service.js";
import {
  parseOnSearchResponse,
  SearchValidationError,
} from "../utils/search-validation.js";

export const createOnSearchController =
  (onSearchService: OnSearchService) =>
  async (request: Request, response: Response): Promise<void> => {
    console.log("[on-search.controller] incoming /on_search request");
    try {
      const callback = parseOnSearchResponse(request.body);
      console.log("[on-search.controller] callback parsed", {
        transactionId: callback.context.transaction_id,
        messageId: callback.context.message_id,
        bppId: callback.context.bpp_id,
        providerCount: callback.message.catalog["bpp/providers"].length,
      });
      await onSearchService.handleCallback(callback);
      console.log("[on-search.controller] /on_search ACK sent");
      response.status(200).json({ message: { ack: { status: "ACK" } } });
    } catch (error) {
      console.log(
        "[on-search.controller] /on_search failed",
        error instanceof Error ? error.message : error,
      );
      if (error instanceof SearchValidationError) {
        response.status(200).json({
          message: { ack: { status: "NACK" } },
          error: {
            type: "JSON-SCHEMA-ERROR",
            code: "20001",
            message: error.message,
          },
        });
        return;
      }
      if (
        error instanceof Error &&
        error.message === "search transaction not found"
      ) {
        response.status(200).json({
          message: { ack: { status: "NACK" } },
          error: {
            type: "CONTEXT-ERROR",
            code: "20004",
            message: error.message,
          },
        });
        return;
      }
      response
        .status(500)
        .json({
          error: {
            code: "ON_SEARCH_FAILED",
            message: "Unable to stage callback",
          },
        });
    }
  };
