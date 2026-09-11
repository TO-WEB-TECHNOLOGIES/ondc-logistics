import type { Request, Response } from "express";
import type { DrizzleSearchRepository } from "../repositories/search.repository.js";

/**
 * @swagger
 * /logistics/search/{searchId}/options:
 *   get:
 *     summary: Poll for /on_search catalog results
 *     tags: [Search]
 *     parameters:
 *       - in: path
 *         name: searchId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Catalog options are ready.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 searchId: { type: string }
 *                 status: { type: string, enum: [READY] }
 *                 options:
 *                   type: array
 *                   items: { type: object }
 *       202:
 *         description: Search accepted, no callback yet.
 *       404:
 *         description: Unknown searchId.
 */
export const createSearchOptionsController =
  (repository: DrizzleSearchRepository) =>
  async (request: Request, response: Response): Promise<void> => {
    try {
      const result = await repository.getSearchOptions(
        String(request.params.searchId),
      );
      if (result.status === "NOT_FOUND") {
        response.status(404).json({
          error: { code: "SEARCH_NOT_FOUND", message: "Search not found" },
        });
        return;
      }
      if (result.status === "PENDING") {
        response.status(202).json({
          searchId: String(request.params.searchId),
          status: "PENDING",
          options: [],
        });
        return;
      }
      response.status(200).json({
        searchId: String(request.params.searchId),
        status: "READY",
        options: result.options,
      });
    } catch (error) {
      console.error("[search-options.controller] failed", error);
      response.status(500).json({
        error: {
          code: "SEARCH_OPTIONS_FAILED",
          message: "Unable to load search options",
        },
      });
    }
  };
