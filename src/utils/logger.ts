import { appendFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { indianNowISO } from "./indian-time.js";
import { logSwitches } from "../config/log-switches.js";

const LOG_DIR = join(process.cwd(), "logs");

// ─── Per-role log filenames (3-process split, 2026-06-20) ─────────────────────
// The three PM2 processes (webhook / worker / api) share the same working dir, so
// NODE_ROLE suffixes every on-disk filename. Default "api" when NODE_ROLE is unset.
const ROLE = process.env.NODE_ROLE || "api";

// ─── 3 logger categories, daily-rotated (2026-07-04) ───────────────────────────
// Every namespace maps to exactly one category, each in its own logs/<category>/
// subfolder with a new file every day (logs/<category>/<category>-<role>-<date>.log):
//   - "ondc": everything logged via ondcLog.* (inbound/outbound/ack/sse ONDC traffic).
//   - "api":  the new frontend-API request/response + SSE-notification logger
//             (src/index.ts's API-logging middleware, sse-manager.ts).
//   - "normal": everything else — the general catch-all (DB errors, cron, business
//             logic, etc.) that used to be the only category.
type LogCategory = "normal" | "ondc" | "api";

function categoryFor(namespace: string): LogCategory {
  if (namespace === "ondc") return "ondc";
  if (namespace === "api") return "api";
  return "normal";
}

function switchFor(category: LogCategory): boolean {
  if (category === "ondc") return logSwitches.ondc;
  if (category === "api") return logSwitches.api;
  return logSwitches.app;
}

function ensureLogDir(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function formatTimestamp() {
  return indianNowISO();
}

// yyyy-MM-dd portion of the IST timestamp — the daily rotation boundary.
function todayIST(): string {
  return formatTimestamp().slice(0, 10);
}

function write(level: string, namespace: string, message: string, meta?: Record<string, any>) {
  const category = categoryFor(namespace);

  // Global kill switch (src/config/log-switches.ts) — gated per category.
  if (!switchFor(category)) return;

  const timestamp = formatTimestamp();
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
  const line = `[${timestamp}] [${level}] [${namespace}] ${message}${metaStr}\n`;

  // Console is reserved for critical (ERROR) entries only — everything else is file-only.
  // (The new API-logging middleware prints its own one-line-per-request console summary
  // separately, outside this function — see src/index.ts.)
  if (level === "ERROR") {
    process.stderr.write(line);
  }

  try {
    const categoryDir = join(LOG_DIR, category);
    ensureLogDir(categoryDir);
    const file = `${category}-${ROLE}-${todayIST()}.log`;
    appendFileSync(join(categoryDir, file), line);
  } catch (err) {
    process.stderr.write(`[${timestamp}] [ERROR] [logger] Failed to write to log file: ${(err as Error).message}\n`);
  }
}

// ─── Postgres error extractor (2026-06-08) ─────────────────────────────────────
//
// WHY: drizzle-orm throws a DrizzleQueryError whose `.message` is only the wrapper
// "Failed query: <sql>\nparams: <...>". The ACTUAL Postgres failure (relation does
// not exist, permission denied, constraint violation, etc.) is on `.cause` — the
// node-postgres error — and was being discarded everywhere we logged `err.message`.
// That masked the on_search_staging / ondc_providers / pg_transaction failures.
//
// This pulls the diagnostic fields off the underlying pg error so a single log line
// shows the real reason. Spread the result into a logger.error meta object, e.g.
//   logger.error("ns", "msg", { ...pgErrorInfo(err) });
// pg_code values worth recognising: 42P01 (undefined_table), 42501 (insufficient_
// privilege), 23505 (unique_violation), 23503 (foreign_key_violation).
export function pgErrorInfo(err: any): Record<string, unknown> {
  // The pg error is on err.cause for Drizzle wrappers; fall back to err itself.
  const cause = err?.cause ?? err;
  return {
    message: err?.message,
    pg_code: cause?.code,
    pg_detail: cause?.detail,
    pg_table: cause?.table,
    pg_constraint: cause?.constraint,
    // Only include the cause message when it differs from the wrapper, to avoid
    // duplicating the (already-logged) "Failed query" text.
    ...(cause?.message && cause.message !== err?.message
      ? { cause_message: cause.message }
      : {}),
  };
}

export const logger = {
  info: (namespace: string, message: string, meta?: Record<string, any>) => {
    write("INFO", namespace, message, meta);
  },
  warn: (namespace: string, message: string, meta?: Record<string, any>) => {
    write("WARN", namespace, message, meta);
  },
  error: (namespace: string, message: string, meta?: Record<string, any>) => {
    write("ERROR", namespace, message, meta);
  },
  debug: (namespace: string, message: string, meta?: Record<string, any>) => {
    write("DEBUG", namespace, message, meta);
  },
};
