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

const protocol = {
  domain: process.env.ONDC_DOMAIN ?? "nic2004:60232",
  country: process.env.ONDC_COUNTRY ?? "IND",
  city: process.env.ONDC_CITY ?? "std:080",
  coreVersion: process.env.ONDC_CORE_VERSION ?? "1.2.0",
  bapId: process.env.BAP_ID ?? process.env.SUBSCRIBER_ID ?? "",
  bapUri: process.env.BAP_URI ?? "",
};

const transport = new GatewayOndcTransport();
const issueRepository = new DrizzleIssueRepository();
const issueService = new IssueService({
  transport,
  repository: issueRepository,
  protocol,
});

export const issueRouter = express.Router();
issueRouter.post("/issue", createIssueController(issueService));
issueRouter.post("/issue_status", createIssueStatusController(issueService));

export const onIssueRouter = express.Router();
onIssueRouter.post("/on_issue", createOnIssueController(issueService));
onIssueRouter.post("/on_issue_status", createOnIssueStatusController(issueService));
