import type { Request, Response } from "express";
import { db1 } from "../db/index.js";
import { loadLogisticsOrder } from "../repositories/logistics-order-shared.js";
import { clientStreamManager } from "../utils/streams/client-stream.js";

const MAX_IDS = 100;

const stringList = (value: unknown, field: string): string[] => {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.some((v) => typeof v !== "string" || !v.trim())
  )
    throw new Error(`${field} must be an array of non-empty strings`);
  return value as string[];
};

/**
 * @swagger
 * /logistics/stream/{clientId}/bind:
 *   post:
 *     summary: Re-bind transactions/orders to a clientId's SSE stream
 *     description: >
 *       Transaction → clientId bindings live in memory (set at /search) and
 *       are lost when the server restarts. After (re)connecting to
 *       GET /logistics/stream/{clientId}, call this with the transactions
 *       and/or orders the client is tracking so their callbacks stream to it
 *       again. Idempotent; last bind wins per transaction. Events missed
 *       while unbound are not replayed — use the poll endpoints to catch up.
 *     tags: [Stream]
 *     parameters:
 *       - in: path
 *         name: clientId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               transactionIds: { type: array, items: { type: string } }
 *               orderIds: { type: array, items: { type: string } }
 *     responses:
 *       200:
 *         description: Bound transaction ids, and any orderIds not found.
 *       400:
 *         description: Invalid body (no ids, wrong types, or more than 100 ids).
 */
export const createStreamBindController =
  () =>
  async (request: Request, response: Response): Promise<void> => {
    const clientId = String(request.params.clientId);
    let transactionIds: string[];
    let orderIds: string[];
    try {
      transactionIds = stringList(request.body?.transactionIds, "transactionIds");
      orderIds = stringList(request.body?.orderIds, "orderIds");
      if (!transactionIds.length && !orderIds.length)
        throw new Error("provide transactionIds and/or orderIds");
      if (transactionIds.length + orderIds.length > MAX_IDS)
        throw new Error(`at most ${MAX_IDS} ids per request`);
    } catch (error) {
      response.status(400).json({
        error: {
          code: "INVALID_STREAM_BIND_REQUEST",
          message: (error as Error).message,
        },
      });
      return;
    }

    try {
      const bound = new Set(transactionIds);
      const notFound: string[] = [];
      for (const orderId of orderIds) {
        const row = await loadLogisticsOrder(db1, orderId);
        if (row?.transactionId) bound.add(row.transactionId);
        else notFound.push(orderId);
      }
      for (const transactionId of bound)
        clientStreamManager.bind(transactionId, clientId);
      console.log("[stream-bind] re-bound transactions to client", {
        clientId,
        boundCount: bound.size,
        notFound,
      });
      response.status(200).json({
        clientId,
        bound: [...bound],
        ...(notFound.length ? { notFound } : {}),
      });
    } catch (error) {
      console.log("[stream-bind] failed", {
        clientId,
        error: error instanceof Error ? error.message : error,
      });
      response.status(500).json({
        error: { code: "STREAM_BIND_FAILED", message: "Unable to bind stream" },
      });
    }
  };
