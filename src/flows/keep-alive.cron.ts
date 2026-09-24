/**
 * Standalone keep-alive pinger for the Render deployment.
 * Run: npm run keep-alive   (separate process; not part of the main app)
 */
const TARGET_URL = "https://ondc-logistics.onrender.com";
const INTERVAL_MS = 14 * 60 * 1000;

async function ping(): Promise<void> {
  const started = Date.now();
  try {
    const res = await fetch(TARGET_URL, { signal: AbortSignal.timeout(60_000) });
    console.log(`[keep-alive] ${new Date().toISOString()} GET ${TARGET_URL} -> ${res.status} (${Date.now() - started}ms)`);
  } catch (error) {
    console.error(`[keep-alive] ${new Date().toISOString()} ping failed:`, error instanceof Error ? error.message : error);
  }
}

void ping();
setInterval(() => void ping(), INTERVAL_MS);
