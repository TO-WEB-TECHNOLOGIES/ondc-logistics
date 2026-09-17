import type { Request, Response } from "express";
import { ConfirmService } from "../services/confirm.service.js";
import {
  ConfirmValidationError,
  parseConfirmRequest,
  parseOnConfirmResponse,
} from "../utils/confirm-validation.js";
import { ondcNack } from "../utils/ondc-error-response.js";
const detail = (e: ConfirmValidationError) => ({
  path: e.path ?? "request",
  message: e.message,
});

/**
 * @swagger
 * /logistics/confirm:
 *   post:
 *     summary: Confirm a logistics order
 *     description: >
 *       Loads the persisted /init + /on_init state, mints an order_id
 *       (generateOrderId), builds and sends the full ONDC /confirm payload
 *       from that state, and persists the resulting logistics_order row.
 *       Idempotent per (transaction_id, action, order_id). Provider, items,
 *       quote, billing, and payment always come from the initialized
 *       transaction — they cannot be supplied or overridden here.
 *     tags: [Confirm]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [initTransactionId]
 *             properties:
 *               initTransactionId:
 *                 type: string
 *                 description: transaction_id from the prior /logistics/init call.
 *               linkedOrder:
 *                 type: object
 *                 description: >
 *                   Optional — maps to @ondc/org/linked_order. Never present in /init or
 *                   /on_init per the contract, so this is the only place to supply it.
 *               fulfillments:
 *                 type: array
 *                 items: { type: object }
 *                 description: >
 *                   Optional — per-fulfillment confirm-only fields not present in /init
 *                   (start.time, start/end.instructions, tags, @ondc/org/awb_no). Matched
 *                   onto the initialized fulfillments by id; identity fields (location,
 *                   contact, person) always come from the initialized transaction.
 *     responses:
 *       202:
 *         description: Confirm accepted and sent to the network.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 orderId: { type: string, example: od260910a1b2c3d4 }
 *                 transactionId: { type: string }
 *                 messageId: { type: string }
 *                 status: { type: string, enum: [CONFIRM_SENT] }
 *       400:
 *         description: Invalid request body.
 *       409:
 *         description: Request does not match the initialized transaction.
 */
export const createConfirmController =
  (service: ConfirmService) =>
  (request: Request, response: Response): void => {
    console.log("[confirm.controller] incoming /confirm request");
    try {
      const input = parseConfirmRequest(request.body);
      console.log("[confirm.controller] /confirm validated", input);
      void service
        .createConfirm(input)
        .then((result) => {
          console.log("[confirm.controller] /confirm accepted", result);
          response.status(202).json(result);
        })
        .catch((error) => {
          console.log("[confirm.controller] /confirm failed", {
            error: error instanceof Error ? error.message : error,
          });
          if (error instanceof ConfirmValidationError) {
            response.status(409).json({
              error: {
                code: "CONFIRM_STATE_INVALID",
                message: error.message,
                path: error.path,
              },
            });
            return;
          }
          if (
            error instanceof Error &&
            /not found|no completed/.test(error.message)
          ) {
            response.status(409).json({
              error: {
                code: "CONFIRM_STATE_INVALID",
                message: error.message,
              },
            });
            return;
          }
          response.status(502).json({
            error: {
              code: "CONFIRM_SUBMISSION_FAILED",
              message: "Unable to submit ONDC confirm request",
            },
          });
        });
    } catch (error) {
      if (error instanceof ConfirmValidationError) {
        console.log(
          "[confirm.controller] /confirm validation failed",
          detail(error),
        );
        response.status(400).json({
          error: {
            code: "INVALID_CONFIRM_REQUEST",
            message: "Invalid confirm request",
            details: [detail(error)],
          },
        });
        return;
      }
      console.log("[confirm.controller] unexpected failure", error);
      response.status(500).json({
        error: {
          code: "CONFIRM_FAILED",
          message: "Unable to process confirm request",
        },
      });
    }
  };

/**
 * @swagger
 * /on_confirm:
 *   post:
 *     summary: ONDC callback — order confirmation result from an LSP
 *     description: >
 *       Called by the LSP/BPP network, not by the frontend. Always responds 200 with
 *       ACK/NACK; updates the logistics_order row in place with the BPP's returned order.
 *     tags: [Confirm]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Standard ONDC /on_confirm envelope (context + message.order, or error).
 *     responses:
 *       200:
 *         description: ACK or NACK.
 */
export const createOnConfirmController =
  (service: ConfirmService) =>
  (request: Request, response: Response): void => {
    console.log("[on-confirm.controller] incoming /on_confirm request");
    try {
      const callback = parseOnConfirmResponse(request.body);
      console.log("[on-confirm.controller] /on_confirm validated", {
        transactionId: callback.context.transaction_id,
        messageId: callback.context.message_id,
        bppId: callback.context.bpp_id,
        orderId: callback.message?.order?.id,
        state: callback.message?.order?.state,
        hasError: Boolean(callback.error),
      });
      void service
        .handleCallback(callback)
        .then((result) => {
          console.log("[on-confirm.controller] /on_confirm result", {
            transactionId: callback.context.transaction_id,
            orderId: callback.message?.order?.id,
            result,
          });
          if (result === "not_found") {
            response.status(200).json(
              ondcNack({
                type: "CONTEXT-ERROR",
                code: "63002",
                message: "confirm transaction not found",
              }),
            );
            return;
          }
          if (result === "invalid_order") {
            response.status(200).json(
              ondcNack({
                type: "CONTEXT-ERROR",
                code: "63002",
                message: "on_confirm order.id does not match confirm order.id",
              }),
            );
            return;
          }
          if (result === "invalid_bpp") {
            response.status(200).json(
              ondcNack({
                type: "CONTEXT-ERROR",
                code: "63002",
                message: "on_confirm bpp_id does not match confirm bpp_id",
              }),
            );
            return;
          }
        })
        .catch((error) => {
          console.log("[on-confirm.controller] processing failed", {
            transactionId: callback.context.transaction_id,
            orderId: callback.message?.order?.id,
            error:
              error instanceof Error ? (error.stack ?? error.message) : error,
          });
          response.status(500).json({
            error: {
              code: "ON_CONFIRM_FAILED",
              message: "Unable to process callback",
            },
          });
        });
        console.log("[on-confirm.controller] BEFORE RESPONSE");

        response.status(200).json({
          message: {
            ack: {
              status: "ACK",
            },
          },
        });

        console.log("[on-confirm.controller] AFTER RESPONSE");
    } catch (error) {
      if (error instanceof ConfirmValidationError) {
        console.log("[on-confirm.controller] validation failed", detail(error));
        response.status(200).json(
          ondcNack({
            type: "JSON-SCHEMA-ERROR",
            code: "63002",
            message: error.message,
          }),
        );
        return;
      }
      console.log("[on-confirm.controller] unexpected failure", error);
      response.status(500).json({
        error: {
          code: "ON_CONFIRM_FAILED",
          message: "Unable to process callback",
        },
      });
    }
  };
