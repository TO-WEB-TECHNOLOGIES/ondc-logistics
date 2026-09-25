import type { Request, Response } from "express";
import { TrackService } from "../services/track.service.js";
import { ondcNack, ondcSubmissionFailure } from "../utils/ondc-error-response.js";
import {
  TrackValidationError,
  parseOnTrackResponse,
  parseTrackRequest,
} from "../utils/track-validation.js";
import { createCallbackStream } from "../utils/streams/callback-stream.js";

const detail = (e: TrackValidationError) => ({
  path: e.path ?? "request",
  message: e.message,
});

/**
 * @swagger
 * /logistics/track:
 *   post:
 *     summary: Request live tracking info for a confirmed order
 *     description: >
 *       Minimal app-level request — just orderId. Per the contract, this
 *       should only be called after the rider is assigned and the order has
 *       been picked up with fulfillment tracking enabled — otherwise the LSP
 *       NACKs with error code 60012. The actual tracking snapshot (URL, live
 *       GPS, breadcrumb path) arrives asynchronously via /on_track, delivered
 *       via the same SSE stream as /status
 *       (GET /logistics/orders/{orderId}/status/events, event "order_tracking")
 *       or poll (GET /logistics/orders/{orderId}/track).
 *     tags: [Track]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [orderId]
 *             properties:
 *               orderId: { type: string, example: od260910a1b2c3d4 }
 *               context:
 *                 type: object
 *                 properties:
 *                   transaction_id: { type: string }
 *                   message_id: { type: string }
 *     responses:
 *       202:
 *         description: Track request accepted and sent to the network.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 orderId: { type: string }
 *                 transactionId: { type: string }
 *                 messageId: { type: string }
 *                 status: { type: string, enum: [TRACK_SENT] }
 *       400:
 *         description: Invalid request body.
 *       409:
 *         description: orderId not found.
 */
export const createTrackController =
  (service: TrackService) =>
  (request: Request, response: Response): void => {
    console.log("[track.controller] incoming /track request");
    try {
      const input = parseTrackRequest(request.body);
      console.log("[track.controller] /track validated", input);
      void service
        .createTrack(input)
        .then((result) => {
          console.log("[track.controller] /track accepted", result);
          response.status(202).json(result);
        })
        .catch((error) => {
          console.log("[track.controller] /track failed", {
            error: error instanceof Error ? error.message : error,
          });
          const submission = ondcSubmissionFailure(error);
          if (submission) {
            response.status(submission.status).json(submission.body);
            return;
          }
          if (error instanceof TrackValidationError) {
            response.status(409).json({
              error: {
                code: "TRACK_STATE_INVALID",
                message: error.message,
                path: error.path,
              },
            });
            return;
          }
          response.status(502).json({
            error: {
              code: "TRACK_SUBMISSION_FAILED",
              message: "Unable to submit ONDC track request",
            },
          });
        });
    } catch (error) {
      if (error instanceof TrackValidationError) {
        console.log("[track.controller] /track validation failed", detail(error));
        response.status(400).json({
          error: {
            code: "INVALID_TRACK_REQUEST",
            message: "Invalid track request",
            details: [detail(error)],
          },
        });
        return;
      }
      console.log("[track.controller] unexpected failure", error);
      response.status(500).json({
        error: {
          code: "TRACK_FAILED",
          message: "Unable to process track request",
        },
      });
    }
  };

/**
 * @swagger
 * /on_track:
 *   post:
 *     summary: ONDC callback — live tracking info from an LSP
 *     description: >
 *       Called by the LSP/BPP network, not by the frontend. Always solicited
 *       (in response to /track). Always responds 200 with ACK/NACK; updates
 *       logistics_order's tracking snapshot columns and publishes an
 *       "order_tracking" SSE event to any subscribers of this order.
 *     tags: [Track]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Standard ONDC /on_track envelope (context + message.tracking, or error).
 *     responses:
 *       200:
 *         description: ACK or NACK.
 */
export const createOnTrackController =
  (service: TrackService) =>
  (request: Request, response: Response): void => {
    console.log("[on-track.controller] incoming /on_track request");
    try {
      const callback = parseOnTrackResponse(request.body);
      console.log("[on-track.controller] /on_track validated", {
        transactionId: callback.context.transaction_id,
        messageId: callback.context.message_id,
        bppId: callback.context.bpp_id,
        fulfillmentId: callback.message?.tracking?.id,
        hasError: Boolean(callback.error),
      });
      const stream = createCallbackStream();
      void service
        .handleCallback(callback, stream)
        .then((result) => {
          console.log("[on-track.controller] /on_track result", {
            transactionId: callback.context.transaction_id,
            result,
          });
        })
        .catch((error) => {
          console.log("[on-track.controller] processing failed", {
            transactionId: callback.context.transaction_id,
            error:
              error instanceof Error ? (error.stack ?? error.message) : error,
          });
        });

      // ONDC requires an immediate ACK; async processing continues above.
      // Events it emits are held until this ACK has been written.
      stream.releaseAfterAck(response);
      response.status(200).json({ message: { ack: { status: "ACK" } } });
    } catch (error) {
      if (error instanceof TrackValidationError) {
        console.log("[on-track.controller] validation failed", detail(error));
        response.status(200).json(
          ondcNack({
            type: "JSON-SCHEMA-ERROR",
            code: "63002",
            message: error.message,
          }),
        );
        return;
      }
      console.log("[on-track.controller] unexpected failure", error);
      response.status(500).json({
        error: {
          code: "ON_TRACK_FAILED",
          message: "Unable to process callback",
        },
      });
    }
  };
