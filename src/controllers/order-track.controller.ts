import type { Request, Response } from "express";
import type { TrackRepository } from "../repositories/track.repository.js";

/**
 * @swagger
 * /logistics/orders/{orderId}/track:
 *   get:
 *     summary: Poll the latest known tracking snapshot for an order (no ONDC call)
 *     description: >
 *       Reads logistics_order directly — fast initial-load path and fallback
 *       for the SSE stream. Only the latest position is returned; the
 *       breadcrumb path history is not persisted (SSE-only).
 *     tags: [Track]
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Latest known tracking snapshot.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 orderId: { type: string }
 *                 url: { type: string }
 *                 status: { type: string }
 *                 gps: { type: string }
 *                 locationTimestamp: { type: string, format: date-time }
 *                 updatedAt: { type: string, format: date-time }
 *       404:
 *         description: Unknown orderId.
 */
export const createOrderTrackController =
  (repository: TrackRepository) =>
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
        url: row.trackingUrl ?? undefined,
        status: row.trackingStatus ?? undefined,
        gps: row.trackingGps ?? undefined,
        locationTimestamp: row.trackingLocationTimestamp?.toISOString(),
        updatedAt: (row.trackingUpdatedAt ?? row.updatedAt).toISOString(),
      });
    } catch (error) {
      console.error("[order-track.controller] failed", error);
      response.status(500).json({
        error: {
          code: "ORDER_TRACK_FAILED",
          message: "Unable to load order tracking",
        },
      });
    }
  };
