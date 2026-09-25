import type { Request, Response } from "express";
import { IssueService } from "../services/issue.service.js";
import { ondcNack, ondcSubmissionFailure } from "../utils/ondc-error-response.js";
import {
  IssueValidationError,
  parseCheckIssueStatusRequest,
  parseCreateIssueRequest,
  parseOnIssueResponse,
  parseOnIssueStatusResponse,
  parseUpdateIssueRequest,
  toCallbackItems,
} from "../schemas/issue.schema.js";
import { createCallbackStream } from "../utils/streams/callback-stream.js";

const detail = (e: IssueValidationError) => ({
  path: e.path ?? "request",
  message: e.message,
});

/**
 * @swagger
 * /logistics/issue:
 *   post:
 *     summary: Raise a new IGM complaint, or update an existing one
 *     description: >
 *       Body without `issue_id` raises a new complaint (order_id, category_code,
 *       descriptor_long_desc, items[] required — category_code is one of
 *       constants/issueCategories.ts's IssueCategoryCode). Body with `issue_id`
 *       updates an existing complaint (issue_id + action_code required;
 *       action_code one of RESOLUTION_ACCEPTED | RESOLUTION_REJECTED |
 *       INFO_PROVIDED | CLOSED | OPEN | ESCALATED). Backend resolves bpp
 *       routing/history from the persisted order/issue and sends /issue;
 *       the request is only durably settled once /on_issue confirms it.
 *     tags: [Issue]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       202:
 *         description: /issue request accepted and sent to the network.
 *       400:
 *         description: Invalid request body.
 *       409:
 *         description: order_id/issue_id not found, or an invalid state transition.
 */
export const createIssueController =
  (service: IssueService) =>
  (request: Request, response: Response): void => {
    console.log("[issue.controller] incoming /issue request");
    try {
      const isUpdate = Boolean((request.body as Record<string, unknown>)?.issue_id);
      if (isUpdate) {
        const input = parseUpdateIssueRequest(request.body);
        console.log("[issue.controller] /issue (update) validated", input);
        void service
          .updateIssue(input)
          .then((result) => {
            console.log("[issue.controller] /issue (update) accepted", result);
            response.status(202).json(result);
          })
          .catch((error) => {
            console.log("[issue.controller] /issue (update) failed", {
              error: error instanceof Error ? error.message : error,
            });
            const submission = ondcSubmissionFailure(error);
            if (submission) {
              response.status(submission.status).json(submission.body);
              return;
            }
            if (error instanceof IssueValidationError) {
              response.status(409).json({
                error: {
                  code: "ISSUE_STATE_INVALID",
                  message: error.message,
                  path: error.path,
                },
              });
              return;
            }
            response.status(502).json({
              error: {
                code: "ISSUE_SUBMISSION_FAILED",
                message: "Unable to submit ONDC /issue update",
              },
            });
          });
        return;
      }

      const input = parseCreateIssueRequest(request.body);
      console.log("[issue.controller] /issue (create) validated", input);
      void service
        .createIssue(input)
        .then((result) => {
          console.log("[issue.controller] /issue (create) accepted", result);
          response.status(202).json(result);
        })
        .catch((error) => {
          console.log("[issue.controller] /issue (create) failed", {
            error: error instanceof Error ? error.message : error,
          });
          const submission = ondcSubmissionFailure(error);
          if (submission) {
            response.status(submission.status).json(submission.body);
            return;
          }
          if (error instanceof IssueValidationError) {
            response.status(409).json({
              error: {
                code: "ISSUE_STATE_INVALID",
                message: error.message,
                path: error.path,
              },
            });
            return;
          }
          response.status(502).json({
            error: {
              code: "ISSUE_SUBMISSION_FAILED",
              message: "Unable to submit ONDC /issue request",
            },
          });
        });
    } catch (error) {
      if (error instanceof IssueValidationError) {
        console.log("[issue.controller] /issue validation failed", detail(error));
        response.status(400).json({
          error: {
            code: "INVALID_ISSUE_REQUEST",
            message: "Invalid issue request",
            details: [detail(error)],
          },
        });
        return;
      }
      console.log("[issue.controller] unexpected failure", error);
      response.status(500).json({
        error: { code: "ISSUE_FAILED", message: "Unable to process issue request" },
      });
    }
  };

/**
 * @swagger
 * /on_issue:
 *   post:
 *     summary: ONDC callback — /issue result or update from an LSP
 *     description: >
 *       Called by the LSP/BPP network, not by the frontend. Can be solicited
 *       (a reply to our /issue) or unsolicited (a counterparty pushes an issue
 *       update directly). Always responds 200 with ACK/NACK; persistence
 *       happens asynchronously, before any application-facing effect.
 *     tags: [Issue]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: ACK or NACK.
 */
export const createOnIssueController =
  (service: IssueService) =>
  (request: Request, response: Response): void => {
    console.log("[on-issue.controller] incoming /on_issue request");
    try {
      // workbench.ondc.tech has been observed sending this as either a bare
      // callback object or a JSON array wrapping a single one — tolerate both.
      const items = toCallbackItems(request.body);
      const validated: ReturnType<typeof parseOnIssueResponse>[] = [];
      let firstError: IssueValidationError | undefined;
      for (const item of items) {
        try {
          validated.push(parseOnIssueResponse(item));
        } catch (error) {
          if (!(error instanceof IssueValidationError)) throw error;
          firstError ??= error;
          console.log("[on-issue.controller] /on_issue item validation failed", detail(error));
        }
      }

      if (validated.length === 0 && firstError) {
        console.log("[on-issue.controller] all items failed validation", detail(firstError));
        response.status(200).json(
          ondcNack({
            type: "JSON-SCHEMA-ERROR",
            code: "63002",
            message: firstError.message,
          }),
        );
        return;
      }

      const stream = createCallbackStream();
      for (const callback of validated) {
        console.log("[on-issue.controller] /on_issue validated", {
          transactionId: callback.context.transaction_id,
          messageId: callback.context.message_id,
          bppId: callback.context.bpp_id,
          issueId: callback.message?.issue?.id,
          hasError: Boolean(callback.error),
        });
        void service
          .handleOnIssue(callback, stream)
          .then((result) => {
            console.log("[on-issue.controller] /on_issue result", {
              transactionId: callback.context.transaction_id,
              issueId: callback.message?.issue?.id,
              result,
            });
          })
          .catch((error) => {
            console.log("[on-issue.controller] processing failed", {
              transactionId: callback.context.transaction_id,
              error: error instanceof Error ? (error.stack ?? error.message) : error,
            });
          });
      }

      // ONDC requires an immediate ACK; async processing continues above.
      // Events it emits are held until this ACK has been written.
      stream.releaseAfterAck(response);
      response.status(200).json({ message: { ack: { status: "ACK" } } });
    } catch (error) {
      console.log("[on-issue.controller] unexpected failure", error);
      response.status(500).json({
        error: { code: "ON_ISSUE_FAILED", message: "Unable to process callback" },
      });
    }
  };

/**
 * @swagger
 * /logistics/issue_status:
 *   post:
 *     summary: Poll the current status of an IGM complaint
 *     description: >
 *       Minimal app-level request — issue_id only. Backend loads the issue's
 *       stored bpp routing/transaction, builds and sends the ONDC
 *       /issue_status payload, and returns immediately; the updated status
 *       arrives via /on_issue_status.
 *     tags: [Issue]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [issue_id]
 *             properties:
 *               issue_id: { type: string }
 *     responses:
 *       202:
 *         description: /issue_status request accepted and sent to the network.
 *       400:
 *         description: Invalid request body.
 *       409:
 *         description: issue_id not found.
 */
export const createIssueStatusController =
  (service: IssueService) =>
  (request: Request, response: Response): void => {
    console.log("[issue.controller] incoming /issue_status request");
    try {
      const input = parseCheckIssueStatusRequest(request.body);
      console.log("[issue.controller] /issue_status validated", input);
      void service
        .checkIssueStatus(input)
        .then((result) => {
          console.log("[issue.controller] /issue_status accepted", result);
          response.status(202).json(result);
        })
        .catch((error) => {
          console.log("[issue.controller] /issue_status failed", {
            error: error instanceof Error ? error.message : error,
          });
          const submission = ondcSubmissionFailure(error);
          if (submission) {
            response.status(submission.status).json(submission.body);
            return;
          }
          if (error instanceof IssueValidationError) {
            response.status(409).json({
              error: {
                code: "ISSUE_STATE_INVALID",
                message: error.message,
                path: error.path,
              },
            });
            return;
          }
          response.status(502).json({
            error: {
              code: "ISSUE_STATUS_SUBMISSION_FAILED",
              message: "Unable to submit ONDC /issue_status request",
            },
          });
        });
    } catch (error) {
      if (error instanceof IssueValidationError) {
        console.log("[issue.controller] /issue_status validation failed", detail(error));
        response.status(400).json({
          error: {
            code: "INVALID_ISSUE_STATUS_REQUEST",
            message: "Invalid issue_status request",
            details: [detail(error)],
          },
        });
        return;
      }
      console.log("[issue.controller] unexpected failure", error);
      response.status(500).json({
        error: {
          code: "ISSUE_STATUS_FAILED",
          message: "Unable to process issue_status request",
        },
      });
    }
  };

/**
 * @swagger
 * /on_issue_status:
 *   post:
 *     summary: ONDC callback — /issue_status result from an LSP
 *     description: >
 *       Called by the LSP/BPP network, not by the frontend, always as a
 *       reply to our /issue_status. Always responds 200 with ACK/NACK.
 *     tags: [Issue]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: ACK or NACK.
 */
export const createOnIssueStatusController =
  (service: IssueService) =>
  (request: Request, response: Response): void => {
    console.log("[on-issue-status.controller] incoming /on_issue_status request");
    try {
      // workbench.ondc.tech sends this as a JSON array wrapping a single
      // callback object (confirmed from live traffic) — tolerate a bare
      // object too, in case another BPP sends the un-wrapped form.
      const items = toCallbackItems(request.body);
      const validated: ReturnType<typeof parseOnIssueStatusResponse>[] = [];
      let firstError: IssueValidationError | undefined;
      for (const item of items) {
        try {
          validated.push(parseOnIssueStatusResponse(item));
        } catch (error) {
          if (!(error instanceof IssueValidationError)) throw error;
          firstError ??= error;
          console.log(
            "[on-issue-status.controller] /on_issue_status item validation failed",
            detail(error),
          );
        }
      }

      if (validated.length === 0 && firstError) {
        console.log(
          "[on-issue-status.controller] all items failed validation",
          detail(firstError),
        );
        response.status(200).json(
          ondcNack({
            type: "JSON-SCHEMA-ERROR",
            code: "63002",
            message: firstError.message,
          }),
        );
        return;
      }

      const stream = createCallbackStream();
      for (const callback of validated) {
        console.log("[on-issue-status.controller] /on_issue_status validated", {
          transactionId: callback.context.transaction_id,
          messageId: callback.context.message_id,
          bppId: callback.context.bpp_id,
          issueId: callback.message?.issue?.id,
          hasError: Boolean(callback.error),
        });
        void service
          .handleOnIssueStatus(callback, stream)
          .then((result) => {
            console.log("[on-issue-status.controller] /on_issue_status result", {
              transactionId: callback.context.transaction_id,
              issueId: callback.message?.issue?.id,
              result,
            });
          })
          .catch((error) => {
            console.log("[on-issue-status.controller] processing failed", {
              transactionId: callback.context.transaction_id,
              error: error instanceof Error ? (error.stack ?? error.message) : error,
            });
          });
      }

      stream.releaseAfterAck(response);
      response.status(200).json({ message: { ack: { status: "ACK" } } });
    } catch (error) {
      console.log("[on-issue-status.controller] unexpected failure", error);
      response.status(500).json({
        error: {
          code: "ON_ISSUE_STATUS_FAILED",
          message: "Unable to process callback",
        },
      });
    }
  };
