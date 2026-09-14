import type { Request, Response } from "express";
import type { SearchService } from "../services/search.service.js";
import {
  parseMinimalSearchRequest,
  parseSearchRequest,
  SearchValidationError,
} from "../utils/search-validation.js";
import { logger, pgErrorInfo } from "../utils/logger.js";

/**
 * @swagger
 * /logistics/search:
 *   post:
 *     summary: Start a logistics search
 *     description: >
 *       Minimal app-level request. The backend generates transaction_id/message_id,
 *       builds the full ONDC /search intent, sends it, and returns a searchId used to
 *       poll for /on_search results (GET /logistics/search/{searchId}/options or the
 *       SSE stream).
 *     tags: [Search]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [category_id, start, end, schedule, payload]
 *             properties:
 *               client_id:
 *                 type: string
 *                 description: >
 *                   Optional. A frontend-generated id for an already-open
 *                   GET /logistics/stream/{clientId} connection — binds that
 *                   stream to this search's transaction_id so it receives
 *                   on_search/on_init/on_confirm/... events for it.
 *               category_id:
 *                 type: string
 *                 example: Immediate Delivery
 *               start:
 *                 type: object
 *                 required: [gps, address]
 *                 properties:
 *                   gps:
 *                     type: string
 *                     example: "12.9716,77.5946"
 *                   address:
 *                     type: object
 *                     required: [name, building, locality, city, state, country, area_code]
 *                     properties:
 *                       name: { type: string }
 *                       building: { type: string }
 *                       locality: { type: string }
 *                       city: { type: string }
 *                       state: { type: string }
 *                       country: { type: string }
 *                       area_code: { type: string }
 *               end:
 *                 type: object
 *                 description: Same shape as `start`.
 *               schedule:
 *                 type: object
 *                 description: Pickup/delivery scheduling window.
 *               payload:
 *                 type: object
 *                 required: [weight, dimensions, category, value]
 *                 properties:
 *                   weight:
 *                     type: object
 *                     properties: { unit: { type: string }, value: { type: string } }
 *                   dimensions:
 *                     type: object
 *                     properties:
 *                       length: { type: object }
 *                       breadth: { type: object }
 *                       height: { type: object }
 *                   category: { type: string }
 *                   value:
 *                     type: object
 *                     properties: { currency: { type: string }, value: { type: string } }
 *     responses:
 *       202:
 *         description: Search accepted and sent to the network.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 searchId: { type: string }
 *                 transactionId: { type: string }
 *       400:
 *         description: Invalid request body.
 */
export const createSearchController =
  (searchService: SearchService) =>
  async (request: Request, response: Response): Promise<void> => {
    console.log("[search.controller] incoming /search request");
    try {
      const clientId =
        typeof request.body?.client_id === "string"
          ? request.body.client_id
          : undefined;
      const result = await searchService.createSearch(
        parseMinimalSearchRequest(request.body),
        clientId,
      );
      console.log("[search.controller] /search accepted", {
        searchId: result.searchId,
        transactionId: result.transactionId,
      });
      response.status(202).json(result);
    } catch (error) {
      console.log(
        "[search.controller] /search failed",
        error instanceof Error ? error.message : error,
      );
      if (error instanceof SearchValidationError) {
        response.status(400).json({
          error: { code: "INVALID_SEARCH_REQUEST", message: error.message },
        });
        return;
      }
      logger.error("search", "Search request failed.", pgErrorInfo(error));
      response.status(500).json({
        error: { code: "SEARCH_FAILED", message: "Unable to create search" },
      });
    }
  };
