import type { Request, Response } from "express";
import { StatusService } from "../services/status.service.js";
import {
  ondcNack,
  ondcSubmissionFailure,
  ondcAck,
  syncResponseContext,
  ondcInternalErrorNack,
  ONDC_INTERNAL_ERROR_HTTP_STATUS,
} from "../utils/ondc-error-response.js";
import {
  StatusValidationError,
  parseOnStatusResponse,
  parseStatusRequest,
} from "../utils/status-validation.js";
import { createCallbackStream } from "../utils/streams/callback-stream.js";

const detail = (e: StatusValidationError) => ({
  path: e.path ?? "request",
  message: e.message,
});

/**
 * @swagger
 * /logistics/status:
 *   post:
 *     summary: Request the current status of a confirmed order
 *     description: >
 *       Minimal app-level request — just orderId. Backend loads the order's
 *       stored bpp routing, builds and sends the ONDC /status payload
 *       (message: {order_id}), and returns immediately; the actual status
 *       arrives asynchronously via /on_status, delivered to the frontend via
 *       SSE (GET /logistics/orders/{orderId}/status/events) or poll
 *       (GET /logistics/orders/{orderId}/status).
 *     tags: [Status]
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
 *         description: Status request accepted and sent to the network.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 orderId: { type: string }
 *                 transactionId: { type: string }
 *                 messageId: { type: string }
 *                 status: { type: string, enum: [STATUS_SENT] }
 *       400:
 *         description: Invalid request body.
 *       409:
 *         description: orderId not found.
 */
export const createStatusController =
  (service: StatusService) =>
  (request: Request, response: Response): void => {
    console.log("[status.controller] incoming /status request");
    try {
      const input = parseStatusRequest(request.body);
      console.log("[status.controller] /status validated", input);
      void service
        .createStatus(input)
        .then((result) => {
          console.log("[status.controller] /status accepted", result);
          response.status(202).json(result);
        })
        .catch((error) => {
          console.log("[status.controller] /status failed", {
            error: error instanceof Error ? error.message : error,
          });
          const submission = ondcSubmissionFailure(error);
          if (submission) {
            response.status(submission.status).json(submission.body);
            return;
          }
          if (error instanceof StatusValidationError) {
            response.status(409).json({
              error: {
                code: "STATUS_STATE_INVALID",
                message: error.message,
                path: error.path,
              },
            });
            return;
          }
          response.status(502).json({
            error: {
              code: "STATUS_SUBMISSION_FAILED",
              message: "Unable to submit ONDC status request",
            },
          });
        });
    } catch (error) {
      if (error instanceof StatusValidationError) {
        console.log("[status.controller] /status validation failed", detail(error));
        response.status(400).json({
          error: {
            code: "INVALID_STATUS_REQUEST",
            message: "Invalid status request",
            details: [detail(error)],
          },
        });
        return;
      }
      console.log("[status.controller] unexpected failure", error);
      response.status(500).json({
        error: {
          code: "STATUS_FAILED",
          message: "Unable to process status request",
        },
      });
    }
  };

/**
 * @swagger
 * /on_status:
 *   post:
 *     summary: ONDC callback — order status from an LSP
 *     description: >
 *       Called by the LSP/BPP network, not by the frontend. Can be solicited
 *       (in response to /status) or unsolicited (pushed proactively). Always
 *       responds 200 with ACK/NACK; updates the logistics_order row and
 *       publishes an SSE event to any subscribers of this order.
 *     tags: [Status]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Standard ONDC /on_status envelope (context + message.order, or error).
 *     responses:
 *       200:
 *         description: ACK or NACK.
 */
export const createOnStatusController =
  (service: StatusService) =>
  (request: Request, response: Response): void => {
    console.log("[on-status.controller] incoming /on_status request");
    try {
      const callback = parseOnStatusResponse(request.body);
      console.log("[on-status.controller] /on_status validated", {
        transactionId: callback.context.transaction_id,
        messageId: callback.context.message_id,
        bppId: callback.context.bpp_id,
        orderId: callback.message?.order?.id,
        hasError: Boolean(callback.error),
      });
      const stream = createCallbackStream();
      void service
        .handleCallback(callback, stream)
        .then((result) => {
          console.log("[on-status.controller] /on_status result", {
            transactionId: callback.context.transaction_id,
            orderId: callback.message?.order?.id,
            result,
          });
        })
        .catch((error) => {
          console.log("[on-status.controller] processing failed", {
            transactionId: callback.context.transaction_id,
            error:
              error instanceof Error ? (error.stack ?? error.message) : error,
          });
        });

      // ONDC requires an immediate ACK; async processing continues above.
      // Events it emits are held until this ACK has been written.
      stream.releaseAfterAck(response);
      response.status(200).json(ondcAck(request.body));
    } catch (error) {
      if (error instanceof StatusValidationError) {
        console.log("[on-status.controller] validation failed", detail(error));
        response.status(200).json({
          ...syncResponseContext(request.body),
          ...ondcNack({
            type: "JSON-SCHEMA-ERROR",
            code: "63002",
            message: error.message,
          }),
        });
        return;
      }
      console.log("[on-status.controller] unexpected failure", error);
      response
        .status(ONDC_INTERNAL_ERROR_HTTP_STATUS)
        .json(ondcInternalErrorNack(request.body));
    }
  };
