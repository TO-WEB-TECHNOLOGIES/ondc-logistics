import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as ondcSchema from "./schema/index.js";
// import * as customerSchema from "./customer/schema/index.js";
import { logger } from "../utils/logger.js";

// ─── Process role (3-process split, 2026-06-20) ───────────────────────────────
//
// CHANGELOG 2026-06-20 (3-process split): NODE_ROLE identifies which PM2 process
// this module is loaded in — "webhook" (on_search publisher), "worker" (Kafka
// consumer + BullMQ), or "api" (customer-facing, the default). It drives two
// things below: (1) the application_name stamped on each pool's connections so
// pg_stat_activity can be grouped by process, and (2) which pools connectPostgres
// eagerly verifies at startup, so a process never pre-opens connections for pools
// it doesn't use (e.g. the webhook process must not touch pool1/pool2/poolIngest).
const NODE_ROLE = process.env.NODE_ROLE || "api";
const APP_NAME = `ondc-${NODE_ROLE}`;

// ─── Pool 1 — ONDC catalog + order-flow data ──────────────────────────────────
//
// CHANGELOG 2026-06-06 (BUG-05 / ARCH-08, Sprint 1 Phase 1):
//   max 10 → 50. Under thousands of concurrent users, 10 connections caused
//   request queuing (catalog reads, order-flow writes, and worker DB writes all
//   competed for the same 10 slots). The app connects via RDS Proxy, which
//   multiplexes these onto fewer physical RDS connections, so 50 is safe.
//   SSL is REQUIRED by RDS Proxy. rejectUnauthorized:false trusts the AWS-managed
//   proxy cert without bundling the RDS CA. (Local non-SSL Postgres dev: unset
//   PSQL_URI and disable ssl, or point at an SSL-capable dev DB.)
//
// CHANGELOG 2026-06-20 (3-process split): `max` is now env-configurable (POOL1_MAX,
//   default 50) so each process gets a role-appropriate budget. With 3 processes
//   sharing ondc_db's connection cap, sizing pool1 per-process (api + worker each
//   own a separate pool1 instance) is what keeps the total under the cap and stops
//   a restart in one process from exhausting connections the others need.

const pool1 = new Pool({
  connectionString:
    process.env.PSQL_URI ||
    process.env.DATABASE_URL ||
    "postgresql://postgres:postgres@localhost:5432/ondc",
  max: Number(process.env.POOL1_MAX) || 50,
  application_name: APP_NAME,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  // ssl: { rejectUnauthorized: false },
});

pool1.on("error", (err) =>
  logger.error("db", "[pool1] Unexpected error.", { error: err.message }),
);

// ─── Pool 2 — Customer data ───────────────────────────────────────────────────
//
// CHANGELOG 2026-06-06 (BUG-05, Sprint 1 Phase 1): max 10 → 25, SSL for RDS Proxy.
// Env var stays PSQL_URI_AUTH (existing convention — not renamed to CUST_PSQL_URI).
//
// CHANGELOG 2026-06-20 (3-process split): `max` is now env-configurable (POOL2_MAX,
//   default 25) — the worker process can run a smaller customer pool than the api.

const pool2 = new Pool({
  connectionString:
    process.env.PSQL_URI_AUTH ||
    "postgresql://postgres:postgres@localhost:5432/ondc_customer",
  max: Number(process.env.POOL2_MAX) || 25,
  application_name: APP_NAME,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  // ssl: { rejectUnauthorized: false },
});

pool2.on("error", (err) =>
  logger.error("db", "[pool2] Unexpected error.", { error: err.message }),
);

// ─── Pool Ingest — Kafka catalog-consumer writes only (ARCH-08) ───────────────
//
// CHANGELOG 2026-06-06 (ARCH-08, Sprint 1 Phase 1):
//   Dedicated pool against ondc_db (same PSQL_URI as pool1) used exclusively by
//   the Kafka /on_search catalog consumer (catalog-kafka.consumer.ts). Catalog
//   ingestion fires thousands of SQL ops per BPP refresh; isolating it from pool1
//   prevents a burst of catalog writes from starving connections for user-facing
//   API reads. NOTE: the api/worker process split (ARCH-04) already isolates these
//   at the process level — full write-path routing through poolIngest is gated on
//   threading a db handle through the on-search repository (see ARCH-08 follow-up).
//   Larger idle timeout (60s) since ingestion is bursty, not steady-state.

const poolIngest = new Pool({
  connectionString:
    process.env.PSQL_URI ||
    process.env.DATABASE_URL ||
    "postgresql://postgres:postgres@localhost:5432/ondc",
  // 2026-06-20 (3-process split): env-configurable (POOL_INGEST_MAX, default 15).
  // This pool only does the consumer's staging-table bookkeeping (claim/done/fail),
  // so the worker can keep it small and leave more of ondc_db's budget for pool1.
  max: Number(process.env.POOL_INGEST_MAX) || 15,
  application_name: APP_NAME,
  idleTimeoutMillis: 60_000,
  // 2026-06-17: raised 5s → 15s. The consumer's `status=done` bookkeeping update was failing
  // with "Connection terminated due to connection timeout" under ingest load (heavy STEP 8
  // cache rewrite blocking the loop / RDS-Proxy pressure), so the offset never committed and
  // Kafka redelivered the row → reprocess loop. 15s lets the connection acquire ride through
  // a burst so the offset commits on the first pass.
  connectionTimeoutMillis: 15_000,
  // ssl: { rejectUnauthorized: false },
});

poolIngest.on("error", (err) =>
  logger.error("db", "[poolIngest] Unexpected error.", { error: err.message }),
);

// ─── Pool Webhook — /on_search publisher staging writes only ──────────────────
//
// CHANGELOG 2026-06-20 (3-process split):
//   Dedicated pool for the ondc-webhook process. It ONLY writes raw payloads to
//   on_search_staging (via publishOnSearch) before publishing a pointer to Kafka.
//   Isolated from pool1 so the heavy unsolicited /on_search traffic never competes
//   with customer API connections, AND so the webhook process opens connections
//   ONLY against this pool (connectPostgres below verifies just this one for the
//   webhook role). Same DB as pool1 (ondc_db, PSQL_URI); each op is a single fast
//   insert, so a small pool (POOL_WEBHOOK_MAX, default 15) is enough.

const poolWebhook = new Pool({
  connectionString:
    process.env.PSQL_URI ||
    process.env.DATABASE_URL ||
    "postgresql://postgres:postgres@localhost:5432/ondc",
  max: Number(process.env.POOL_WEBHOOK_MAX) || 15,
  application_name: APP_NAME,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  // ssl: { rejectUnauthorized: false },
});

poolWebhook.on("error", (err) =>
  logger.error("db", "[poolWebhook] Unexpected error.", { error: err.message }),
);

// ─── Drizzle clients ─────────────────────────────────────────────────────────

/** ONDC catalog, BPP, provider, item, category, on_select, on_init tables */
export const db1 = drizzle(pool1, { schema: ondcSchema });

/** Customer profile, address, and related tables */
// export const db2 = drizzle(pool2, { schema: customerSchema });

/**
 * ONDC catalog ingestion client (ARCH-08) — same schema as db1, but backed by
 * the dedicated poolIngest so the Kafka catalog consumer never competes with
 * API reads on pool1. Used by catalog-kafka.consumer.ts only.
 */
export const db1Ingest = drizzle(poolIngest, { schema: ondcSchema });

/**
 * ONDC /on_search staging client (3-process split) — same schema as db1, backed by
 * the dedicated poolWebhook. Used by the producer's staging INSERT (publishOnSearch)
 * so the ondc-webhook process writes staging rows on its own connection budget,
 * never touching pool1.
 */
export const db1Webhook = drizzle(poolWebhook, { schema: ondcSchema });

export { pool1, pool2, poolIngest, poolWebhook };

// ─── Health check helper ─────────────────────────────────────────────────────

// Verify a single pool at startup so a misconfigured pool fails fast (here) rather
// than on the first request/callback. Logs which pool connected for that role.
const verifyPool = (pool: Pool, label: string) =>
  pool.connect().then((c) => {
    c.release();
    logger.info("db", `[${label}] Connected.`);
  });

/**
 * Role-aware startup verification (3-process split, 2026-06-20).
 *
 * Each PM2 process verifies — and therefore pre-opens connections against — ONLY
 * the pools it actually uses, so e.g. the webhook process never opens pool1/pool2/
 * poolIngest connections it would never query. Pools left unverified still connect
 * lazily on first query, so an unexpected query path is not broken — it just isn't
 * eagerly pre-warmed. NODE_ROLE comes from the PM2 env block per app:
 *   webhook → poolWebhook                (on_search staging only)
 *   worker  → pool1 + pool2 + poolIngest (catalog upserts, order jobs, staging bookkeeping)
 *   api     → pool1 + pool2              (catalog reads + order-flow + customer)
 */
export const connectPostgres = async (): Promise<void> => {
  const checks: Array<Promise<void>> = [];

  if (NODE_ROLE === "webhook") {
    checks.push(verifyPool(poolWebhook, "poolWebhook"));
  } else if (NODE_ROLE === "worker") {
    checks.push(verifyPool(pool1, "pool1"));
    checks.push(verifyPool(pool2, "pool2"));
    checks.push(verifyPool(poolIngest, "poolIngest"));
  } else {
    // "api" (default) — customer-facing reads/writes only.
    checks.push(verifyPool(pool1, "pool1"));
    checks.push(verifyPool(pool2, "pool2"));
  }

  await Promise.all(checks);
};
