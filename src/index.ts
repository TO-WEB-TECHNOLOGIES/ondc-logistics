import express from "express";
import type { Request, Response } from "express";
import http from "http";
import swaggerUi from "swagger-ui-express";
// Sentry namespace — only used here for the Express error handler and flush.
// SDK init/instrumentation happens in src/instrument.ts, preloaded via --import.
import * as Sentry from "@sentry/node";
import { router } from "./routes/index.js";
import { swaggerSpec } from "./utils/swagger.js";
import { connectPostgres } from "./db/index.js";
// import "./utils/redis.js";

// RECON-01 (2026-07-11): settlement-cron.service.ts deleted entirely — settlement preparation is
// no longer cron-driven; /recon is sent manually per order (POST /admin/orders/:order_id/recon in
// routes/index.ts). See ARCHITECTURE_REVIEW.md's RECON-01 entry.
// QUOTE-CLEANUP-01 (2026-07-13): daily 2:30am cleanup of expired, never-initialized quote
// sessions — mode controlled by src/config/quote-cleanup-switches.ts.
// STAGING-CLEANUP-01 (2026-07-14): daily 3:00am hard-delete of COMPLETED on_search_staging rows
// older than 2 days — **PREPROD ONLY**; startStagingCleanupCron self-skips when ENV=PROD, where
// the staging table keeps its full raw-payload history. Runs on this (api) process because it
// already owns the only other db1 read of that table (countPendingStagingRows, the overlap
// circuit-breaker) — no new pool coupling.
// import { startQuoteCleanupCron, startStagingCleanupCron } from "./services/quote-cleanup.service.js";
import { logger } from "./utils/logger.js";
// import { apiLogMiddleware } from "./middleware/api-log.middleware.js";

const app = express();
const server = http.createServer(app);

// Track shutdown state to prevent duplicate calls
let isShuttingDown = false;

// Graceful shutdown handler to close server, database, Redis, and BullMQ workers
const gracefulShutdown = async (signal: string) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info("server", `${signal} received. Starting graceful shutdown...`);

  // ARCH-04: BullMQ workers now run in the `ondc-worker` process and are shut
  // down there — the API process must not import ./workers/index.js (that would
  // instantiate and start the workers in this process).

  // Close Redis connection
//   const { closeRedis } = await import("./utils/redis.js");
//   closeRedis();
  logger.info("server", "Redis connection closed.");

  // Close HTTP server (stops accepting new connections)
  server.close(() => {
    logger.info("server", "HTTP server closed.");
    logger.info("server", "Graceful shutdown completed.");
    process.exit(0);
  });

  // Force exit if graceful shutdown takes too long (10 seconds)
  setTimeout(() => {
    logger.error("server", "Forced shutdown after timeout.");
    process.exit(1);
  }, 10000);
};

// Register shutdown listeners
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// BUG-12 (2026-06-06): process-level safety nets. Previously a single unhandled
// rejection or uncaught exception took down the whole API; with no handler the
// default Node behaviour and lost in-memory state (SSE bindings, timers) made
// failures opaque. An unhandled REJECTION is logged but not fatal (the rest of
// the server is still healthy); an uncaught EXCEPTION leaves the process in an
// undefined state, so we log and exit(1) and let PM2 restart cleanly.
process.on("unhandledRejection", (reason: unknown) => {
  logger.error("server", "Unhandled promise rejection (continuing).", {
    reason: reason instanceof Error ? reason.stack : String(reason),
  });
});
process.on("uncaughtException", (err: Error) => {
  logger.error("server", "Uncaught exception — exiting for clean PM2 restart.", {
    error: err.stack ?? err.message,
  });
  // Sentry's OnUncaughtException integration already captured this error; flush
  // the async transport before exiting so the event is actually delivered (a
  // bare process.exit(1) would drop in-flight events). Exit regardless of the
  // flush outcome to preserve the clean PM2-restart behaviour above.
  void Sentry.flush(2000).finally(() => process.exit(1));
});

const startApp = async () => {
  try {
    if (process.env.NODE_ENV === "production") {
    //   await connectPostgres();
    } else {
      logger.warn("server", "Skipping eager Postgres verification outside production.");
    }
    // startCronJobs();
    // startQuoteCleanupCron();
    // startStagingCleanupCron();
  } catch (err: any) {
    logger.error("server", "Application startup failed due to database connection or migration error.", {
      error: err.message,
      stack: err.stack,
    });
    process.exit(1);
  }
};

// startApp();

// Health check — registered before all middleware (JSON parser, CORS) so liveness
// probes (PM2, load balancer / target-group checks) get a fast, dependency-free 200
// even when the app is under load. LIVENESS only: confirms the process is up; it does
// NOT verify DB/Redis/Kafka (that would be a readiness check — see note in PR).
app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});

// limit (2026-07-14): lowered 10mb → 1mb. The 10mb ceiling existed for multi-MB /on_search
// catalog payloads, but /on_search no longer runs on this process — the 3-process split moved
// it to the dedicated `ondc-webhook` app (src/webhook.ts), which keeps its own 10mb limit.
// Every route left here is KB-scale: the ONDC order-flow callbacks (/on_select, /on_init,
// /on_confirm, /on_status, /on_cancel, /on_update, /on_issue, /on_recon), the PG webhooks, and
// the buyer-facing routes. 1mb is still 10x Express's 100 KB default — ample headroom for the
// largest realistic order (many line items + customizations + quote breakup) — while capping
// what a misbehaving or hostile caller can force us to buffer and parse on the customer-facing
// event loop. body-parser's inflate:true (default) already decompresses gzip/deflate bodies,
// and it enforces the limit on the DECOMPRESSED size, so this also bounds a zip-bomb body.
//
// verify (2026-06-15): capture the EXACT raw request bytes (post-inflate, pre-JSON.parse)
// onto req.rawBody so ONDC signature verification can hash what the BPP actually signed.
// Previously verification hashed JSON.stringify(req.body), which differs byte-for-byte from
// the sender whenever its serializer escapes forward slashes (https:\/\/...) or non-ASCII
// (\uXXXX) — making valid signatures fail with 401. The buffer is small relative to the JSON
// object already kept in memory.
app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf;
    },
  }),
);

// Frontend API request/response logger (src/middleware/api-log.middleware.ts) — needs
// req.body, so must sit after the JSON parser above; needs to wrap every route, so must
// sit before the /api/v1 router mount below.
// app.use(apiLogMiddleware);

// CORS whitelist — only these origins are allowed.
// Browser requests from other origins will be blocked by CORS.
// Note: Server-to-server callbacks (Juspay/HDFC webhooks) do NOT go through CORS
// since they are not browser requests — they bypass CORS entirely.
const ALLOWED_ORIGINS = [
  "https://calc.ustart.in",
  "http://localhost:5173"
];

app.get("/", (req: Request, res: Response) => {
  res.send("Hello World!");
});

app.use(router);

// Swagger UI — available at /swagger
// app.use("/swagger", swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
//   customCss: ".swagger-ui .topbar { display: none }",
//   customSiteTitle: "ONDC BAP API",
// }));

// Sentry Express error handler — MUST be registered after all controllers/routes
// and before any other (fall-through) error middleware. Captures errors thrown
// in route handlers and reports them to Sentry.
Sentry.setupExpressErrorHandler(app);

server.listen(3000, () => {
  logger.info("server", "Server started on port 3000");
});
