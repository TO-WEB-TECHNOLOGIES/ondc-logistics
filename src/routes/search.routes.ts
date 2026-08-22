import express from "express";
import { createOnSearchController } from "../controllers/on-search.controller.js";
import { createSearchController } from "../controllers/search.controller.js";
import { OnSearchService } from "../services/on-search.service.js";
import { SearchService } from "../services/search.service.js";
import { GatewayOndcTransport } from "../utils/ondc-transport.js";
import { DrizzleSearchRepository } from "../repositories/search.repository.js";
import { DrizzleOnSearchRepository } from "../repositories/on-search.repository.js";
import { searchSseManager } from "../utils/search-sse.js";
const searchService = new SearchService({ transport: new GatewayOndcTransport(), repository: new DrizzleSearchRepository(), protocol: { domain: process.env.ONDC_DOMAIN ?? "nic2004:60232", country: process.env.ONDC_COUNTRY ?? "IND", city: process.env.ONDC_CITY ?? "std:080", coreVersion: process.env.ONDC_CORE_VERSION ?? "1.2.0", bapId: process.env.BAP_ID ?? process.env.SUBSCRIBER_ID ?? "", bapUri: process.env.BAP_URI ?? process.env.BFF ?? "", ttl: process.env.ONDC_TTL ?? "PT30S" } });
const onSearchRepository = new DrizzleOnSearchRepository();
const onSearchService = new OnSearchService(onSearchRepository);
export const searchRouter = express.Router();
export const onSearchRouter = express.Router();
searchRouter.post("/search", createSearchController(searchService));
searchRouter.get("/search/:searchId/events", (request, response) => { searchSseManager.subscribe(request.params.searchId, response); });
onSearchRouter.post("/on_search", createOnSearchController(onSearchService));

