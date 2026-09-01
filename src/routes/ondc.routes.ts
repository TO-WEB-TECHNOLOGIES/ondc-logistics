import express from "express";
import { createOnSearchController } from "../controllers/on-search.controller.js";
import { createSearchController } from "../controllers/search.controller.js";
import {
  createInitController,
  createOnInitController,
} from "../controllers/init.controller.js";
import {
  createConfirmController,
  createOnConfirmController,
} from "../controllers/confirm.controller.js";
import { OnSearchService } from "../services/on-search.service.js";
import { SearchService } from "../services/search.service.js";
import { InitService } from "../services/init.service.js";
import { ConfirmService } from "../services/confirm.service.js";
import { GatewayOndcTransport } from "../utils/ondc-transport.js";
import { DrizzleSearchRepository } from "../repositories/search.repository.js";
import { DrizzleOnSearchRepository } from "../repositories/on-search.repository.js";
import { DrizzleInitRepository } from "../repositories/init.repository.js";
import { DrizzleConfirmRepository } from "../repositories/confirm.repository.js";
import { searchSseManager } from "../utils/search-sse.js";

const protocol = {
  domain: process.env.ONDC_DOMAIN ?? "nic2004:60232",
  country: process.env.ONDC_COUNTRY ?? "IND",
  city: process.env.ONDC_CITY ?? "std:080",
  coreVersion: process.env.ONDC_CORE_VERSION ?? "1.2.0",
  bapId: process.env.BAP_ID ?? process.env.SUBSCRIBER_ID ?? "",
  bapUri: process.env.BAP_URI ?? "",
  ttl: process.env.ONDC_TTL ?? "PT30S",
};

const transport = new GatewayOndcTransport();
const searchService = new SearchService({
  transport,
  repository: new DrizzleSearchRepository(),
  protocol,
});
const onSearchService = new OnSearchService(new DrizzleOnSearchRepository());
const initService = new InitService({
  transport,
  repository: new DrizzleInitRepository(),
});
const confirmService = new ConfirmService({
  transport,
  repository: new DrizzleConfirmRepository(),
});

export const searchRouter = express.Router();
searchRouter.post("/search", createSearchController(searchService));

searchRouter.get("/search/:searchId/events", (request, response) => {
  searchSseManager.subscribe(request.params.searchId, response);
});

export const onSearchRouter = express.Router();
onSearchRouter.post("/on_search", createOnSearchController(onSearchService));

export const initRouter = express.Router();
initRouter.post("/init", createInitController(initService));

export const onInitRouter = express.Router();
onInitRouter.post("/on_init", createOnInitController(initService));

export const confirmRouter = express.Router();
confirmRouter.post("/confirm", createConfirmController(confirmService));

export const onConfirmRouter = express.Router();
onConfirmRouter.post("/on_confirm", createOnConfirmController(confirmService));

