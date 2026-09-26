import type { NextFunction, Request, Response } from "express";
import {
  OndcContextError,
  validateCallbackContext,
  type CallbackContextExpectation,
} from "../utils/ondc-context.js";
import { ondcNack, syncResponseContext } from "../utils/ondc-error-response.js";

/**
 * Runs before every /on_* controller: validates each context field of the
 * inbound callback and NACKs (CONTEXT-ERROR 63002, echoing the received
 * context) before any business processing if one is missing or invalid.
 */
export const callbackContextMiddleware =
  (expected: CallbackContextExpectation) =>
  (request: Request, response: Response, next: NextFunction): void => {
    try {
      // Tolerate the array-wrapped form some senders use (see on_issue_status).
      const items: unknown[] = Array.isArray(request.body)
        ? request.body
        : [request.body];
      if (items.length === 0)
        throw new OndcContextError("context", "is required");
      for (const item of items) validateCallbackContext(item, expected);
      next();
    } catch (error) {
      if (!(error instanceof OndcContextError)) {
        next(error);
        return;
      }
      console.log("[callback-context] invalid context", {
        action: expected.action,
        path: error.path,
        message: error.message,
      });
      response.status(200).json({
        ...syncResponseContext(request.body),
        ...ondcNack({
          type: "CONTEXT-ERROR",
          code: "63002",
          message: error.message,
        }),
      });
    }
  };
