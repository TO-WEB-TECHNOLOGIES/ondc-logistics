import express from "express";
import {
  createIssueController,
  createIssueStatusController,
  createOnIssueController,
  createOnIssueStatusController,
} from "../controllers/issue.controller.js";
import { IssueService } from "../services/issue.service.js";
import { DrizzleIssueRepository } from "../repositories/issue.repository.js";
import { GatewayOndcTransport } from "../utils/ondc-transport.js";
import { noApiLogMiddleware } from "../middlewares/no-api-log.middleware.js";
import { ondcProtocol } from "../config/ondc-protocol.js";
import { loadTransactionContext } from "../repositories/transaction-context.js";
import { callbackContextMiddleware } from "../middlewares/callback-context.middleware.js";

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

// IGM callbacks carry their own domain/core_version, so only action + bap_id are pinned.
export const onIssueRouter = express.Router();
onIssueRouter.post("/on_issue", noApiLogMiddleware, callbackContextMiddleware({ action: "on_issue", bapId: ondcProtocol.bapId || undefined, cityOptional: true }), createOnIssueController(issueService));
onIssueRouter.post("/on_issue_status", noApiLogMiddleware, callbackContextMiddleware({ action: "on_issue_status", bapId: ondcProtocol.bapId || undefined, cityOptional: true }), createOnIssueStatusController(issueService));
