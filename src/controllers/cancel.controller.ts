import type { Request, Response } from "express";
import { CancelService } from "../services/cancel.service.js";
import { ondcNack, ondcSubmissionFailure } from "../utils/ondc-error-response.js";
import {
  CancelValidationError,
  parseOnCancelResponse,
  parseCancelRequest,
} from "../utils/cancel-validation.js";
import { createCallbackStream } from "../utils/streams/callback-stream.js";
import { getCancellationReasonText } from "../constants/cancellation-reason-codes.js";

const detail = (e: CancelValidationError) => ({
  path: e.path ?? "request",
  message: e.message,
});

/**
 * @swagger
 * /logistics/cancel:
 *   post:
 *     summary: Cancel a confirmed order
 *     description: >
 *       Minimal app-level request — orderId + cancellationReasonId. Backend loads the
 *       order's stored bpp routing, builds and sends the ONDC /cancel payload (message:
 *       {order_id, cancellation_reason_id}), and returns immediately; the order is only
 *       marked cancelled once /on_cancel actually confirms it — delivered to the frontend
 *       via SSE (GET /logistics/orders/{orderId}/status/events) or poll
 *       (GET /logistics/orders/{orderId}/status).
 *     tags: [Cancel]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [orderId, cancellationReasonId]
 *             properties:
 *               orderId: { type: string, example: od260910a1b2c3d4 }
 *               cancellationReasonId: { type: string, example: "011" }
 *               context:
 *                 type: object
 *                 properties:
 *                   transaction_id: { type: string }
 *                   message_id: { type: string }
 *     responses:
 *       202:
 *         description: Cancellation request accepted and sent to the network.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 orderId: { type: string }
 *                 transactionId: { type: string }
 *                 messageId: { type: string }
 *                 status: { type: string, enum: [CANCEL_SENT] }
 *       400:
 *         description: Invalid request body (incl. a cancellationReasonId this NP may not send).
 *       409:
 *         description: orderId not found, or order is already cancelled.
 */
export const createCancelController =
  (service: CancelService) =>
  (request: Request, response: Response): void => {
    console.log("[cancel.controller] incoming /cancel request");
    try {
      const input = parseCancelRequest(request.body);
      console.log("[cancel.controller] /cancel validated", input);
      void service
        .createCancel(input)
        .then((result) => {
          console.log("[cancel.controller] /cancel accepted", result);
          response.status(202).json({
            ...result,
            reasonText: getCancellationReasonText(input.cancellationReasonId),
          });
        })
        .catch((error) => {
          console.log("[cancel.controller] /cancel failed", {
            error: error instanceof Error ? error.message : error,
          });
          const submission = ondcSubmissionFailure(error);
          if (submission) {
            response.status(submission.status).json(submission.body);
            return;
          }
          if (error instanceof CancelValidationError) {
            response.status(409).json({
              error: {
                code: "CANCEL_STATE_INVALID",
                message: error.message,
                path: error.path,
              },
            });
            return;
          }
          response.status(502).json({
            error: {
              code: "CANCEL_SUBMISSION_FAILED",
              message: "Unable to submit ONDC cancel request",
            },
          });
        });
    } catch (error) {
      if (error instanceof CancelValidationError) {
        console.log("[cancel.controller] /cancel validation failed", detail(error));
        response.status(400).json({
          error: {
            code: "INVALID_CANCEL_REQUEST",
            message: "Invalid cancel request",
            details: [detail(error)],
          },
        });
        return;
      }
      console.log("[cancel.controller] unexpected failure", error);
      response.status(500).json({
        error: {
          code: "CANCEL_FAILED",
          message: "Unable to process cancel request",
        },
      });
    }
  };

/**
 * @swagger
 * /on_cancel:
 *   post:
 *     summary: ONDC callback — cancellation result from an LSP
 *     description: >
 *       Called by the LSP/BPP network, not by the frontend. Can be solicited (a reply to
 *       our /cancel) or unsolicited (the LSP cancels the order directly, e.g. an RTO flow)
 *       — both are handled. Always responds 200 with ACK/NACK; the logistics_order row is
 *       only marked state=Cancelled / cancellationStatus=succeeded once this callback
 *       actually confirms it (no error, order.state === "Cancelled"). An errored callback
 *       marks cancellationStatus=failed without touching order state. Publishes an SSE
 *       event to any subscribers of this order once persisted.
 *     tags: [Cancel]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Standard ONDC /on_cancel envelope (context + message.order, or error).
 *     responses:
 *       200:
 *         description: ACK or NACK.
 */
export const createOnCancelController =
  (service: CancelService) =>
  (request: Request, response: Response): void => {
    console.log("[on-cancel.controller] incoming /on_cancel request");
    try {
      const callback = parseOnCancelResponse(request.body);
      console.log("[on-cancel.controller] /on_cancel validated", {
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
          console.log("[on-cancel.controller] /on_cancel result", {
            transactionId: callback.context.transaction_id,
            orderId: callback.message?.order?.id,
            result,
          });
        })
        .catch((error) => {
          console.log("[on-cancel.controller] processing failed", {
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
      if (error instanceof CancelValidationError) {
        console.log("[on-cancel.controller] validation failed", detail(error));
        response.status(200).json(
          ondcNack({
            type: "JSON-SCHEMA-ERROR",
            code: "63002",
            message: error.message,
          }),
        );
        return;
      }
      console.log("[on-cancel.controller] unexpected failure", error);
      response.status(500).json({
        error: {
          code: "ON_CANCEL_FAILED",
          message: "Unable to process callback",
        },
      });
    }
  };
