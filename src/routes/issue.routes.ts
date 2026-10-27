import express from "express";
import {
  createIssueController,
  createIssueDetailsController,
  createIssueStatusController,
  createIssuesListController,
  createOrderIssuesController,
  createOnIssueController,
  createOnIssueStatusController,
} from "../controllers/issue.controller.js";
import { IssueService } from "../services/issue.service.js";
import { DrizzleIssueRepository } from "../repositories/issue.repository.js";
import { GatewayOndcTransport } from "../utils/ondc-transport.js";
import { noApiLogMiddleware } from "../middlewares/no-api-log.middleware.js";
import { callbackLogMiddleware } from "../middlewares/callback-log.middleware.js";
import { ondcProtocol } from "../config/ondc-protocol.js";
import { loadTransactionContext } from "../repositories/transaction-context.js";
import { callbackContextMiddleware } from "../middlewares/callback-context.middleware.js";
import { verifyOndcSignature } from "../middlewares/ondc-signature.middleware.js";

const protocol = ondcProtocol;

const transport = new GatewayOndcTransport();
const issueRepository = new DrizzleIssueRepository();
const issueService = new IssueService({
  transport,
  repository: issueRepository,
  protocol,
  loadTransactionContext,
});

export const issueRouter = express.Router();
issueRouter.post("/issue", createIssueController(issueService));
issueRouter.post("/issue_status", createIssueStatusController(issueService));
issueRouter.get("/issues", createIssuesListController(issueRepository));
issueRouter.get("/issues/:issueId", createIssueDetailsController(issueRepository));
issueRouter.get("/orders/:orderId/issues", createOrderIssuesController(issueRepository));

// IGM callbacks carry their own domain/core_version, so only action + bap_id are pinned.
export const onIssueRouter = express.Router();
onIssueRouter.post("/on_issue", callbackLogMiddleware("on_issue"), noApiLogMiddleware, verifyOndcSignature("on_issue"), callbackContextMiddleware({ action: "on_issue", bapId: ondcProtocol.bapId || undefined, cityOptional: true }), createOnIssueController(issueService));
onIssueRouter.post("/on_issue_status", callbackLogMiddleware("on_issue_status"), noApiLogMiddleware, verifyOndcSignature("on_issue_status"), callbackContextMiddleware({ action: "on_issue_status", bapId: ondcProtocol.bapId || undefined, cityOptional: true }), createOnIssueStatusController(issueService));
