import type { Request, Response } from "express";
import { InitService } from "../services/init.service.js";
import {
  InitValidationError,
  parseInitRequest,
  parseOnInitResponse,
} from "../utils/init-validation.js";
const validation = (error: InitValidationError) => ({
  path: error.path ?? "request",
  message: error.message,
});
export const createInitController =
  (service: InitService) =>
  (request: Request, response: Response): void => {
    console.log("[init.controller] incoming /init request");
    try {
      const payload = parseInitRequest(request.body);
      console.log("[init.controller] /init validated", {
        transactionId: payload.context.transaction_id,
        messageId: payload.context.message_id,
        bppId: payload.context.bpp_id,
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
          response.status(502).json({
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
