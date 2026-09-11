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
