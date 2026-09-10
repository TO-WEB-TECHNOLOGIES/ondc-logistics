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
