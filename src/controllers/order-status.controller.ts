import type { Request, Response } from "express";
import type { StatusRepository } from "../repositories/status.repository.js";

/**
 * @swagger
 * /logistics/orders/{orderId}/status:
 *   get:
 *     summary: Poll the current status of an order (no ONDC call)
 *     description: >
 *       Reads logistics_order directly — fast initial-load path and fallback
 *       for GET /logistics/orders/{orderId}/status/events (SSE) if the
 *       stream drops.
 *     tags: [Status]
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Current known order/fulfillment state.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 orderId: { type: string }
 *                 state: { type: string }
 *                 fulfillmentId: { type: string }
 *                 fulfillmentState: { type: string }
 *                 awbNo: { type: string }
 *                 updatedAt: { type: string, format: date-time }
 *       404:
 *         description: Unknown orderId.
 */
export const createOrderStatusController =
  (repository: StatusRepository) =>
  async (request: Request, response: Response): Promise<void> => {
    try {
      const orderId = String(request.params.orderId);
      const row = await repository.loadOrder(orderId);
      if (!row) {
        response.status(404).json({
          error: { code: "ORDER_NOT_FOUND", message: "Order not found" },
        });
        return;
      }
      response.status(200).json({
        orderId: row.orderId,
        state: row.state ?? undefined,
        fulfillmentId: row.fulfillmentId ?? undefined,
        fulfillmentState: row.fulfillmentStateCode ?? undefined,
        awbNo: row.awbNo ?? undefined,
        updatedAt: row.updatedAt.toISOString(),
      });
    } catch (error) {
      console.error("[order-status.controller] failed", error);
      response.status(500).json({
        error: {
          code: "ORDER_STATUS_FAILED",
          message: "Unable to load order status",
        },
      });
    }
  };
