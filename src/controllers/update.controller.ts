import type { Request, Response } from "express";
import { UpdateService } from "../services/update.service.js";
import { ondcNack } from "../utils/ondc-error-response.js";
import {
  UpdateValidationError,
  parseOnUpdateResponse,
  parseUpdateRequest,
} from "../utils/update-validation.js";

const detail = (e: UpdateValidationError) => ({
  path: e.path ?? "request",
  message: e.message,
});

/**
 * @swagger
 * /logistics/update:
 *   post:
 *     summary: Update a confirmed logistics order
 *     description: >
 *       Single endpoint for all /update kinds — the frontend selects which via
 *       `updateType` (app-specific, never forwarded to ONDC). fulfillmentId is required
 *       on every request and checked against the order's stored fulfillment as an
 *       identity guard. Full request/response examples: docs/update-api.md.
 *     tags: [Update]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             oneOf:
 *               - type: object
 *                 required: [orderId, fulfillmentId, updateType, linkedOrder]
 *                 properties:
 *                   orderId: { type: string, example: od260910a1b2c3d4 }
 *                   fulfillmentId: { type: string, example: "1" }
 *                   updateType: { type: string, enum: [LINKED_ORDER_DETAILS] }
 *                   linkedOrder:
 *                     type: object
 *                     description: At least one field required; omitted fields keep their stored value.
 *                     properties:
 *                       retailOrderId: { type: string }
 *                       productName: { type: string }
 *                       quantityCount: { type: integer }
 *                       weight:
 *                         type: object
 *                         properties: { unit: { type: string }, value: { type: number } }
 *                       dimensions:
 *                         type: object
 *                         properties:
 *                           length: { type: object }
 *                           breadth: { type: object }
 *                           height: { type: object }
 *                       providerName: { type: string }
 *               - type: object
 *                 required: [orderId, fulfillmentId, updateType, instruction]
 *                 properties:
 *                   orderId: { type: string, example: od260910a1b2c3d4 }
 *                   fulfillmentId: { type: string, example: "1" }
 *                   updateType: { type: string, enum: [START_INSTRUCTION, END_INSTRUCTION] }
 *                   instruction:
 *                     type: object
 *                     required: [code]
 *                     properties:
 *                       code: { type: string, example: "2" }
 *                       shortDesc: { type: string }
 *                       longDesc: { type: string }
 *                       images: { type: array, items: { type: string } }
 *               - type: object
 *                 required: [orderId, fulfillmentId, updateType, authorization]
 *                 properties:
 *                   orderId: { type: string, example: od260910a1b2c3d4 }
 *                   fulfillmentId: { type: string, example: "1" }
 *                   updateType: { type: string, enum: [START_AUTHENTICATION, END_AUTHENTICATION] }
 *                   authorization:
 *                     type: object
 *                     required: [token]
 *                     properties:
 *                       type: { type: string, default: OTP }
 *                       token: { type: string, example: "482913" }
 *                       validFrom: { type: string, format: date-time }
 *                       validTo: { type: string, format: date-time }
 *               - type: object
 *                 required: [orderId, fulfillmentId, updateType]
 *                 properties:
 *                   orderId: { type: string, example: od260910a1b2c3d4 }
 *                   fulfillmentId: { type: string, example: "1" }
 *                   updateType: { type: string, enum: [READY_TO_SHIP] }
 *     responses:
 *       202:
 *         description: Update accepted and sent to the network.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 orderId: { type: string }
 *                 transactionId: { type: string }
 *                 messageId: { type: string }
 *                 updateType: { type: string }
 *                 status: { type: string, enum: [UPDATE_SENT] }
 *       400:
 *         description: Invalid request body.
 *       409:
 *         description: orderId not found, or fulfillmentId does not match the order.
 */
export const createUpdateController =
  (service: UpdateService) =>
  (request: Request, response: Response): void => {
    console.log("[update.controller] incoming /update request");
    try {
      const input = parseUpdateRequest(request.body);
      console.log("[update.controller] /update validated", input);
      void service
        .createUpdate(input)
        .then((result) => {
          console.log("[update.controller] /update accepted", result);
          response.status(202).json(result);
        })
        .catch((error) => {
          console.log("[update.controller] /update failed", {
            error: error instanceof Error ? error.message : error,
          });
          if (error instanceof UpdateValidationError) {
            response.status(409).json({
              error: {
                code: "UPDATE_STATE_INVALID",
                message: error.message,
                path: error.path,
              },
            });
            return;
          }
          response.status(502).json({
            error: {
              code: "UPDATE_SUBMISSION_FAILED",
              message: "Unable to submit ONDC update request",
            },
          });
        });
    } catch (error) {
      if (error instanceof UpdateValidationError) {
        console.log("[update.controller] /update validation failed", detail(error));
        response.status(400).json({
          error: {
            code: "INVALID_UPDATE_REQUEST",
            message: "Invalid update request",
            details: [detail(error)],
          },
        });
        return;
      }
      console.log("[update.controller] unexpected failure", error);
      response.status(500).json({
        error: {
          code: "UPDATE_FAILED",
          message: "Unable to process update request",
        },
      });
    }
  };

/**
 * @swagger
 * /on_update:
 *   post:
 *     summary: ONDC callback — update result from an LSP
 *     description: >
 *       Called by the LSP/BPP network, not by the frontend. Always responds 200 with
 *       ACK/NACK; updates the logistics_order row's state and AWB (if returned).
 *     tags: [Update]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Standard ONDC /on_update envelope (context + message.order, or error).
 *     responses:
 *       200:
 *         description: ACK or NACK.
 */
export const createOnUpdateController =
  (service: UpdateService) =>
  (request: Request, response: Response): void => {
    console.log("[on-update.controller] incoming /on_update request");
    try {
      const callback = parseOnUpdateResponse(request.body);
      console.log("[on-update.controller] /on_update validated", {
        transactionId: callback.context.transaction_id,
        messageId: callback.context.message_id,
        bppId: callback.context.bpp_id,
        orderId: callback.message?.order?.id,
        hasError: Boolean(callback.error),
      });
      void service
        .handleCallback(callback)
        .then((result) => {
          console.log("[on-update.controller] /on_update result", {
            transactionId: callback.context.transaction_id,
            orderId: callback.message?.order?.id,
            result,
          });
        })
        .catch((error) => {
          console.log("[on-update.controller] processing failed", {
            transactionId: callback.context.transaction_id,
            error:
              error instanceof Error ? (error.stack ?? error.message) : error,
          });
        });

      // ONDC requires an immediate ACK; async processing continues above.
      response.status(200).json({ message: { ack: { status: "ACK" } } });
    } catch (error) {
      if (error instanceof UpdateValidationError) {
        console.log("[on-update.controller] validation failed", detail(error));
        response.status(200).json(
          ondcNack({
            type: "JSON-SCHEMA-ERROR",
            code: "63002",
            message: error.message,
          }),
        );
        return;
      }
      console.log("[on-update.controller] unexpected failure", error);
      response.status(500).json({
        error: {
          code: "ON_UPDATE_FAILED",
          message: "Unable to process callback",
        },
      });
    }
  };
