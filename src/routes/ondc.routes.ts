import express from "express";
import { createOnSearchController } from "../controllers/on-search.controller.js";
import { createSearchController } from "../controllers/search.controller.js";
import { createSearchOptionsController } from "../controllers/search-options.controller.js";
import {
  createInitController,
  createOnInitController,
} from "../controllers/init.controller.js";
import {
  createConfirmController,
  createOnConfirmController,
} from "../controllers/confirm.controller.js";
import {
  createOnUpdateController,
  createUpdateController,
} from "../controllers/update.controller.js";
import {
  createOnStatusController,
  createStatusController,
} from "../controllers/status.controller.js";
import { createOrderStatusController } from "../controllers/order-status.controller.js";
import {
  createOnTrackController,
  createTrackController,
} from "../controllers/track.controller.js";
import { createOrderTrackController } from "../controllers/order-track.controller.js";
import {
  createCancelController,
  createOnCancelController,
} from "../controllers/cancel.controller.js";
import { OnSearchService } from "../services/on-search.service.js";
import { SearchService } from "../services/search.service.js";
import { InitService } from "../services/init.service.js";
import { ConfirmService } from "../services/confirm.service.js";
import { UpdateService } from "../services/update.service.js";
import { StatusService } from "../services/status.service.js";
import { TrackService } from "../services/track.service.js";
import { CancelService } from "../services/cancel.service.js";
import { GatewayOndcTransport } from "../utils/ondc-transport.js";
import { DrizzleSearchRepository } from "../repositories/search.repository.js";
import { DrizzleOnSearchRepository } from "../repositories/on-search.repository.js";
import { DrizzleInitRepository } from "../repositories/init.repository.js";
import { DrizzleConfirmRepository } from "../repositories/confirm.repository.js";
import { DrizzleUpdateRepository } from "../repositories/update.repository.js";
import { DrizzleStatusRepository } from "../repositories/status.repository.js";
import { DrizzleTrackRepository } from "../repositories/track.repository.js";
import { DrizzleCancelRepository } from "../repositories/cancel.repository.js";
import { searchSseManager } from "../utils/search-sse.js";
import { orderSseManager } from "../utils/order-sse.js";
import { clientStreamManager } from "../utils/client-stream.js";
import { noApiLogMiddleware } from "../middlewares/no-api-log.middleware.js";

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
const searchRepository = new DrizzleSearchRepository();
const searchService = new SearchService({
  transport,
  repository: searchRepository,
  protocol,
});
const onSearchService = new OnSearchService(new DrizzleOnSearchRepository());
const initProtocol = {
  ...protocol,
  bapUri: process.env.BAP_URI ?? process.env.BFF ?? "",
};
const initService = new InitService({
  transport,
  repository: new DrizzleInitRepository(),
  protocol: initProtocol,
});
const confirmService = new ConfirmService({
  transport,
  repository: new DrizzleConfirmRepository(),
});
const updateService = new UpdateService({
  transport,
  repository: new DrizzleUpdateRepository(),
  protocol,
});
const statusRepository = new DrizzleStatusRepository();
const statusService = new StatusService({
  transport,
  repository: statusRepository,
  protocol,
});
const trackRepository = new DrizzleTrackRepository();
const trackService = new TrackService({
  transport,
  repository: trackRepository,
  protocol,
});
const cancelRepository = new DrizzleCancelRepository();
const cancelService = new CancelService({
  transport,
  repository: cancelRepository,
  protocol,
});

export const streamRouter = express.Router();

/**
 * @swagger
 * /logistics/stream/{clientId}:
 *   get:
 *     summary: Unified SSE stream for a frontend-generated clientId
 *     description: >
 *       text/event-stream — a single channel for every async callback
 *       (on_search, on_init, on_confirm, on_status, on_track, on_cancel,
 *       on_update) belonging to whichever transaction_id this clientId gets
 *       bound to. Open this once, before POST /logistics/search, with a
 *       freshly generated clientId (e.g. a UUID). Events carry normalized,
 *       useful fields — never the raw ONDC callback payload.
 *     tags: [Stream]
 *     parameters:
 *       - in: path
 *         name: clientId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: SSE stream (text/event-stream).
 */
streamRouter.get("/stream/:clientId", (request, response) => {
  clientStreamManager.subscribe(request.params.clientId, response);
});

export const searchRouter = express.Router();
searchRouter.post("/search", createSearchController(searchService));

searchRouter.get(
  "/search/:searchId/options",
  createSearchOptionsController(searchRepository),
);

/**
 * @swagger
 * /logistics/search/{searchId}/events:
 *   get:
 *     summary: SSE stream of /on_search results for a search
 *     description: text/event-stream — pushes an event once /on_search callbacks are processed, as an alternative to polling GET /logistics/search/{searchId}/options.
 *     tags: [Search]
 *     parameters:
 *       - in: path
 *         name: searchId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: SSE stream (text/event-stream).
 */
searchRouter.get("/search/:searchId/events", (request, response) => {
  searchSseManager.subscribe(request.params.searchId, response);
});

export const onSearchRouter = express.Router();
onSearchRouter.post("/on_search", noApiLogMiddleware, createOnSearchController(onSearchService));

export const initRouter = express.Router();
initRouter.post("/init", createInitController(initService));

export const onInitRouter = express.Router();
onInitRouter.post("/on_init", noApiLogMiddleware, createOnInitController(initService));

export const confirmRouter = express.Router();
confirmRouter.post("/confirm", createConfirmController(confirmService));

export const onConfirmRouter = express.Router();
onConfirmRouter.post("/on_confirm", noApiLogMiddleware, createOnConfirmController(confirmService));

export const updateRouter = express.Router();
updateRouter.post("/update", createUpdateController(updateService));

export const onUpdateRouter = express.Router();
onUpdateRouter.post("/on_update", noApiLogMiddleware, createOnUpdateController(updateService));

export const statusRouter = express.Router();
statusRouter.post("/status", createStatusController(statusService));

statusRouter.get(
  "/orders/:orderId/status",
  createOrderStatusController(statusRepository),
);

/**
 * @swagger
 * /logistics/orders/{orderId}/status/events:
 *   get:
 *     summary: SSE stream of order status updates
 *     description: text/event-stream — pushes an "order_status" event whenever /on_status is processed for this order, as an alternative to polling GET /logistics/orders/{orderId}/status.
 *     tags: [Status]
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: SSE stream (text/event-stream).
 */
statusRouter.get("/orders/:orderId/status/events", (request, response) => {
  orderSseManager.subscribe(request.params.orderId, response);
});

export const onStatusRouter = express.Router();
onStatusRouter.post("/on_status", noApiLogMiddleware, createOnStatusController(statusService));

export const trackRouter = express.Router();
trackRouter.post("/track", createTrackController(trackService));

trackRouter.get(
  "/orders/:orderId/track",
  createOrderTrackController(trackRepository),
);

export const onTrackRouter = express.Router();
onTrackRouter.post("/on_track", noApiLogMiddleware, createOnTrackController(trackService));

export const cancelRouter = express.Router();
cancelRouter.post("/cancel", createCancelController(cancelService));

export const onCancelRouter = express.Router();
onCancelRouter.post("/on_cancel", noApiLogMiddleware, createOnCancelController(cancelService));
