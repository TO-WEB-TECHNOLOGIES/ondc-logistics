import type { Request, Response } from "express";
import { InitService } from "../services/init.service.js";
import {
  InitValidationError,
  parseInitRequest,
  parseMinimalInitRequest,
  parseOnInitResponse,
} from "../utils/init-validation.js";
const validation = (error: InitValidationError) => ({
  path: error.path ?? "request",
  message: error.message,
});

/**
 * @swagger
 * /logistics/init:
 *   post:
 *     summary: Initialize an order from a selected search option
 *     description: >
 *       Loads the persisted /on_search state for search_id, validates the selected
 *       provider/item/fulfillment, builds and sends the full ONDC /init payload,
 *       preserving the /search transaction_id and minting a new message_id.
 *     tags: [Init]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [search_id, pickup_contact, delivery_contact, billing, payment]
 *             properties:
 *               search_id: { type: string, description: searchId returned by POST /logistics/search }
 *               bpp_id: { type: string }
 *               provider_id: { type: string }
 *               item_id: { type: string }
 *               fulfillment_id: { type: string }
 *               quantity: { type: integer, minimum: 1 }
 *               pickup_contact:
 *                 type: object
 *                 required: [email]
 *                 properties: { email: { type: string }, phone: { type: string } }
 *               delivery_contact:
 *                 type: object
 *                 required: [email]
 *                 properties: { email: { type: string }, phone: { type: string } }
 *               billing:
 *                 type: object
 *                 required: [name, email, tax_number, created_at, updated_at, address]
 *                 properties:
 *                   name: { type: string }
 *                   email: { type: string }
 *                   phone: { type: string }
 *                   tax_number: { type: string }
 *                   created_at: { type: string, format: date-time }
 *                   updated_at: { type: string, format: date-time }
 *                   address:
 *                     type: object
 *                     required: [name, building, locality, city, state, country, area_code]
 *                     properties:
 *                       name: { type: string }
 *                       building: { type: string }
 *                       locality: { type: string }
 *                       street: { type: string }
 *                       city: { type: string }
 *                       state: { type: string }
 *                       country: { type: string }
 *                       area_code: { type: string }
 *               payment:
 *                 type: object
 *                 description: >
 *                   settlement_details is required (non-empty) when type is
 *                   ON-FULFILLMENT; optional/omittable for ON-ORDER and
 *                   POST-FULFILLMENT.
 *                 required: [type, collected_by, amount, currency]
 *                 properties:
 *                   type: { type: string, example: ON-FULFILLMENT }
 *                   collected_by: { type: string, example: BPP }
 *                   amount: { type: string }
 *                   currency: { type: string, example: INR }
 *                   settlement_details:
 *                     type: array
 *                     items: { type: object }
 *     responses:
 *       202:
 *         description: Init accepted and sent to the network.
 *       400:
 *         description: Invalid request body.
 *       404:
 *         description: search option not found.
 *       409:
 *         description: search option is ambiguous.
 *       425:
 *         description: search results not ready yet.
 */
export const createInitController =
  (service: InitService) =>
  (request: Request, response: Response): void => {
    console.log("[init.controller] incoming /init request");
    try {
      const payload = parseMinimalInitRequest(request.body);
      console.log("[init.controller] /init validated", {
        searchId: payload.searchId,
        providerId: payload.providerId,
        itemId: payload.itemId,
        fulfillmentId: payload.fulfillmentId,
      });
      void service
        .createInit(payload)
        .then((result) => {
          console.log("[init.controller] /init accepted", result);
          response.status(202).json(result);
        })
        .catch((error) => {
          console.log("[init.controller] /init failed", {
            error: error instanceof Error ? error.message : error,
          });
          const status =
            error instanceof Error &&
            error.message === "search option not found"
              ? 404
              : error instanceof Error &&
                  error.message === "search option is ambiguous"
                ? 409
                : error instanceof Error &&
                    error.message === "search results not ready"
                  ? 425
                  : 502;
          response.status(status).json({
            error: {
              code: "INIT_SUBMISSION_FAILED",
              message: "Unable to submit ONDC init request",
            },
          });
        });
    } catch (error) {
      if (error instanceof InitValidationError) {
        console.log(
          "[init.controller] /init validation failed",
          validation(error),
        );
        response.status(400).json({
          error: {
            code: "INVALID_INIT_REQUEST",
            message: "Invalid ONDC init request",
            details: [validation(error)],
          },
        });
        return;
      }
      console.log("[init.controller] /init unexpected failure", error);
      response.status(500).json({
        error: {
          code: "INIT_FAILED",
          message: "Unable to process init request",
        },
      });
    }
  };
/**
 * @swagger
 * /on_init:
 *   post:
 *     summary: ONDC callback — initialized order/quote from an LSP
 *     description: Called by the LSP/BPP network, not by the frontend. Always responds 200 with ACK/NACK.
 *     tags: [Init]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Standard ONDC /on_init envelope (context + message.order, or error).
 *     responses:
 *       200:
 *         description: ACK or NACK.
 */
export const createOnInitController =
  (service: InitService) =>
  (request: Request, response: Response): void => {
    console.log("[on-init.controller] incoming /on_init request");
    try {
      const callback = parseOnInitResponse(request.body);
      console.log("[on-init.controller] /on_init validated", {
        transactionId: callback.context.transaction_id,
        messageId: callback.context.message_id,
        bppId: callback.context.bpp_id,
        hasError: Boolean(callback.error),
        hasOrder: Boolean(callback.message?.order),
      });
      void service
        .handleCallback(callback)
        .then((result) => {
          if (result === "not_found") {
            console.log("[on-init.controller] unknown transaction", {
              transactionId: callback.context.transaction_id,
            });
            response.status(200).json({
              message: { ack: { status: "NACK" } },
              error: {
                type: "CONTEXT-ERROR",
                code: "20004",
                message: "init transaction not found",
              },
            });
            return;
          }
          console.log("[on-init.controller] /on_init acknowledged", {
            transactionId: callback.context.transaction_id,
            result,
          });
          response.status(200).json({ message: { ack: { status: "ACK" } } });
        })
        .catch((error) => {
          console.log("[on-init.controller] processing failed", {
            error: error instanceof Error ? error.message : error,
          });
          response.status(500).json({
            error: {
              code: "ON_INIT_FAILED",
              message: "Unable to process callback",
            },
          });
        });
    } catch (error) {
      if (error instanceof InitValidationError) {
        console.log(
          "[on-init.controller] validation failed",
          validation(error),
        );
        response.status(200).json({
          message: { ack: { status: "NACK" } },
          error: {
            type: "JSON-SCHEMA-ERROR",
            code: "20001",
            path: error.path,
            message: error.message,
          },
        });
        return;
      }
      console.log("[on-init.controller] unexpected failure", error);
      response.status(500).json({
        error: {
          code: "ON_INIT_FAILED",
          message: "Unable to process callback",
        },
      });
    }
  };
