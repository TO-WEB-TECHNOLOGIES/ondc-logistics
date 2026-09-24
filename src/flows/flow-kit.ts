/**
 * Shared helpers for the standalone workbench flow runners in src/flows.
 * Every flow runs against the deployed Render service, sends each request,
 * then waits (no timeout) for the matching callback event on the unified SSE
 * stream GET /logistics/stream/:clientId before moving on.
 *
 * Debug logging kill switch — FLOW_DEBUG env var:
 *   FLOW_DEBUG=off | 0 | false   plain step logs only (debug logging disabled)
 *   (unset)                      compact debug: timestamps, every SSE event with ids,
 *                                request timings, 30s wait heartbeats, failure summary
 *                                + JSON dump in reports/flow-runs/
 *   FLOW_DEBUG=full | 1 | true   everything above + full request/response/event payloads
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const BASE_URL = "https://ondc-logistics.onrender.com";
export const clientId = randomUUID();

type DebugLevel = "off" | "on" | "full";

function parseDebugLevel(raw: string | undefined): DebugLevel {
  const value = (raw ?? "").trim().toLowerCase();
  if (["off", "0", "false", "no"].includes(value)) return "off";
  if (["full", "1", "true", "verbose"].includes(value)) return "full";
  return "on";
}

export const DEBUG_LEVEL = parseDebugLevel(process.env.FLOW_DEBUG);
const debugOn = DEBUG_LEVEL !== "off";
const debugFull = DEBUG_LEVEL === "full";

const WAIT_HEARTBEAT_MS = 30_000;
const FAILURE_EVENT_TAIL = 20;

interface StreamEvent {
  event: string;
  data: Record<string, any>;
}

interface ReceivedEvent extends StreamEvent {
  at: number;
}

interface TranscriptEntry {
  at: string;
  elapsedMs: number;
  kind: "request" | "response" | "event" | "note";
  step?: string;
  [key: string]: unknown;
}

const buffer: StreamEvent[] = [];
let notify: (() => void) | undefined;

const flowStarted = Date.now();
let flowName = "flow";
let currentStep = "stream";
let awaiting: string | undefined;
let lastEventAt: number | undefined;
let failing = false;
const received: ReceivedEvent[] = [];
const transcript: TranscriptEntry[] = [];

const elapsed = (from = flowStarted) => `${((Date.now() - from) / 1000).toFixed(1)}s`;

const truncate = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}... (${text.length} chars)` : text;

export const log = (step: string, msg: string) => {
  const prefix = debugOn ? `[flow ${new Date().toISOString().slice(11, 23)} +${elapsed()}]` : "[flow]";
  console.log(`${prefix} ${step.padEnd(22)} ${msg}`);
};

/** Compact debug line; suppressed when FLOW_DEBUG=off. */
const debug = (step: string, msg: string) => {
  if (debugOn) log(step, `· ${msg}`);
};

/** Full pretty-printed payload; only when FLOW_DEBUG=full. */
const dumpPayload = (step: string, label: string, data: unknown) => {
  if (debugFull) log(step, `· ${label}:\n${JSON.stringify(data, null, 2)}`);
};

const record = (entry: Omit<TranscriptEntry, "at" | "elapsedMs">) => {
  if (!debugOn) return;
  transcript.push({ at: new Date().toISOString(), elapsedMs: Date.now() - flowStarted, ...entry } as TranscriptEntry);
};

const ID_KEYS = [
  "searchId",
  "transactionId",
  "transaction_id",
  "messageId",
  "message_id",
  "orderId",
  "order_id",
  "issueId",
  "issue_id",
  "state",
  "status",
] as const;

/** Picks well-known correlation ids/states out of a payload (top level + `context`). */
function idSummary(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const sources = [data as Record<string, any>, (data as Record<string, any>).context].filter(
    (s): s is Record<string, any> => !!s && typeof s === "object",
  );
  const parts: string[] = [];
  for (const key of ID_KEYS) {
    for (const source of sources) {
      const value = source[key];
      if (value !== undefined && value !== null && typeof value !== "object") {
        parts.push(`${key}=${value}`);
        break;
      }
    }
  }
  return parts.length ? ` [${parts.join(" ")}]` : "";
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as Error & { cause?: unknown }).cause;
  return cause ? `${error.message} (cause: ${describeError(cause)})` : error.message;
}

const bufferedNames = () => (buffer.length ? buffer.map((e) => e.event).join(", ") : "none");

export async function openStream(): Promise<void> {
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/logistics/stream/${clientId}`);
  } catch (error) {
    throw new Error(`SSE connect network error after ${elapsed(started)}: ${describeError(error)}`);
  }
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`SSE connect failed: ${res.status}${text ? ` ${truncate(text, 500)}` : ""}`);
  }
  debug("stream", `SSE connected in ${elapsed(started)} (status ${res.status})`);
  void (async () => {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        return failAndExit(new Error(`SSE stream read error: ${describeError(error)}`));
      }
      const { done, value } = chunk;
      if (done) {
        console.error("[flow] SSE stream closed by server");
        const since = lastEventAt ? `${elapsed(lastEventAt)} after last event` : "before any event arrived";
        return failAndExit(new Error(`SSE stream closed by server (${since}) while on step "${currentStep}"`));
      }
      pending += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = pending.indexOf("\n\n")) !== -1) {
        const block = pending.slice(0, idx);
        pending = pending.slice(idx + 2);
        let event = "message";
        let data = "";
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (!data) continue; // comments / heartbeats
        let parsed: Record<string, any>;
        try {
          parsed = JSON.parse(data);
        } catch (error) {
          console.error(`[flow] SSE event "${event}" has invalid JSON (${describeError(error)}): ${truncate(data, 500)}`);
          record({ kind: "event", step: currentStep, event, invalidJson: data });
          continue;
        }
        onEvent(event, parsed);
        buffer.push({ event, data: parsed });
        notify?.();
      }
    }
  })();
}

function onEvent(event: string, data: Record<string, any>): void {
  lastEventAt = Date.now();
  received.push({ event, data, at: lastEventAt });
  record({ kind: "event", step: currentStep, event, data });
  if (!debugOn) return;
  const awaited = event === awaiting || event.endsWith("_error");
  const note = awaited ? "" : awaiting ? ` (buffered, not awaited; waiting for "${awaiting}")` : " (buffered, nothing awaited yet)";
  log(currentStep, `SSE <- "${event}"${idSummary(data)}${note}`);
  dumpPayload(currentStep, `"${event}" payload`, data);
}

/** Waits (indefinitely) for the next `event`; any `<x>_error` event aborts the flow. */
export async function waitFor(step: string, event: string): Promise<Record<string, any>> {
  currentStep = step;
  awaiting = event;
  log(step, `waiting for SSE "${event}"...`);
  if (buffer.length) debug(step, `already buffered: ${bufferedNames()}`);
  const started = Date.now();
  const heartbeat = debugOn
    ? setInterval(() => {
        const last = lastEventAt ? `${elapsed(lastEventAt)} ago` : "never";
        log(step, `still waiting for "${event}" (${elapsed(started)}) — buffered: ${bufferedNames()}; last SSE event ${last}`);
      }, WAIT_HEARTBEAT_MS)
    : undefined;
  try {
    for (;;) {
      const errIdx = buffer.findIndex((e) => e.event.endsWith("_error"));
      if (errIdx !== -1) {
        const [err] = buffer.splice(errIdx, 1);
        dumpPayload(step, `"${err!.event}" error payload`, err!.data);
        throw new Error(`${step}: received ${err!.event} ${JSON.stringify(err!.data)}`);
      }
      const idx = buffer.findIndex((e) => e.event === event);
      if (idx !== -1) {
        const [hit] = buffer.splice(idx, 1);
        log(step, `PASS "${event}" (${elapsed(started)})`);
        return hit!.data;
      }
      await new Promise<void>((resolve) => (notify = resolve));
    }
  } finally {
    clearInterval(heartbeat);
    awaiting = undefined;
  }
}

/** Waits (indefinitely) until `count` events named `event` have arrived, returning them in order. */
export async function waitForCount(
  step: string,
  event: string,
  count: number,
): Promise<Record<string, any>[]> {
  const results: Record<string, any>[] = [];
  for (let i = 1; i <= count; i++) {
    results.push(await waitFor(`${step} (${i}/${count})`, event));
  }
  return results;
}

export async function post(step: string, path: string, body: unknown): Promise<Record<string, any>> {
  currentStep = step;
  dumpPayload(step, `POST ${path} request body`, body);
  record({ kind: "request", step, method: "POST", path, body });
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(`${step}: POST ${path} network error after ${elapsed(started)}: ${describeError(error)}`);
  }
  const text = await res.text().catch(() => "");
  let json: Record<string, any> = {};
  let isJson = true;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      isJson = false;
    }
  }
  record({ kind: "response", step, method: "POST", path, status: res.status, durationMs: Date.now() - started, body: isJson ? json : text });
  if (!isJson) debug(step, `non-JSON response body: ${truncate(text, 500)}`);
  if (!res.ok) {
    throw new Error(`${step}: POST ${path} -> ${res.status} ${isJson ? JSON.stringify(json) : truncate(text, 500)}`);
  }
  log(step, `sent POST ${path} -> ${res.status}${debugOn ? ` (${elapsed(started)})${idSummary(json)}` : ""}`);
  dumpPayload(step, `POST ${path} response body`, json);
  return json;
}

export interface ConfirmedOrder {
  orderId: string;
  fulfillmentId: string;
  initTransactionId: string;
}

/** Steps 1-6: SEARCH, ON_SEARCH, INIT, ON_INIT, CONFIRM, ON_CONFIRM. */
export async function runSearchInitConfirm(): Promise<ConfirmedOrder> {
  const search = await post("1 search", "/logistics/search", {
    client_id: clientId,
    category_id: "Standard Delivery",
    start: {
      gps: "28.984500,77.706400",
      area_code: "250001",
      address: { name: "Pickup Person", building: "123", locality: "Sector 1", street: "Main Road", city: "Meerut", state: "Uttar Pradesh", country: "IND" },
    },
    end: {
      gps: "28.613900,77.209000",
      area_code: "110001",
      address: { name: "Delivery Person", building: "456", locality: "Connaught Place", street: "Main Road", city: "New Delhi", state: "Delhi", country: "IND" },
    },
    schedule: {
      days: "1,2,3,4,5,6,7",
      range_start: "0000",
      range_end: "2359",
      duration: "PT30M",
      holidays: ["2026-01-26", "2026-08-15"],
    },
    payload: {
      weight: { value: 1, unit: "kilogram" },
      dimensions: { length: { value: 10, unit: "centimeter" }, breadth: { value: 10, unit: "centimeter" }, height: { value: 10, unit: "centimeter" } },
      category: "Grocery",
      value: { amount: "100", currency: "INR" },
      dangerous_goods: false,
    },
    payment: { type: "POST-FULFILLMENT", collection_amount: "300.00" },
  });
  const searchResult = await waitFor("2 on_search", "search_result");
  const searchId: string = searchResult.searchId ?? search.searchId;
  const provider = searchResult.provider;
  if (!provider?.providerId) {
    throw new Error(`2 on_search: search_result has no provider.providerId — payload: ${truncate(JSON.stringify(searchResult), 1000)}`);
  }
  const providerId: string = provider.providerId;
  const item = provider.items?.find((i: any) => i.fulfillmentId) ?? provider.items?.[0];
  if (!item?.catalogItemId) {
    throw new Error(`2 on_search: search_result provider has no usable items[].catalogItemId — provider: ${truncate(JSON.stringify(provider), 1000)}`);
  }
  const itemId: string = item.catalogItemId;
  const fulfillmentId: string = item.fulfillmentId ?? provider.fulfillments?.[0]?.fulfillmentId;
  log("2 on_search", `provider=${providerId} item=${itemId} fulfillment=${fulfillmentId}`);
  debug("2 on_search", `searchId=${searchId} items=${provider.items?.length ?? 0} fulfillments=${provider.fulfillments?.length ?? 0}`);
  if (!fulfillmentId) debug("2 on_search", "WARN no fulfillmentId on item or provider.fulfillments[0] — init will be sent without one");

  const init = await post("3 init", "/logistics/init", {
    search_id: searchId,
    provider_id: providerId,
    item_id: itemId,
    fulfillment_id: fulfillmentId,
    pickup_contact: { phone: "9000000000", email: "store@example.com" },
    delivery_contact: { phone: "9111111111", email: "buyer@example.com" },
    billing: {
      name: "Buyer Name",
      email: "buyer@example.com",
      phone: "9111111111",
      tax_number: "GST123456",
      created_at: "2026-09-10T08:00:00.000Z",
      updated_at: "2026-09-10T08:00:00.000Z",
      address: { name: "Home", building: "House 1", locality: "Koramangala", city: "Bengaluru", state: "Karnataka", country: "India", area_code: "560001" },
    },
    payment: { type: "ON-ORDER", collected_by: "BAP", amount: "120.00", currency: "INR" },
  });
  await waitFor("4 on_init", "init_result");
  const initTransactionId: string = init.transactionId;
  debug("4 on_init", `initTransactionId=${initTransactionId}`);
  if (!initTransactionId) debug("4 on_init", "WARN /logistics/init response had no transactionId — confirm will likely fail");

  await post("5 confirm", "/logistics/confirm", {
    initTransactionId,
    fulfillments: [
      {
        id: "1",
        start: { instructions: { code: "2", name: "Handle with care", short_desc: "Fragile item" } },
        end: { instructions: { code: "2", name: "Leave at door", short_desc: "Contactless delivery" } },
        tags: [{ code: "state", list: [{ code: "ready_to_ship", value: "yes" }] }],
      },
    ],
    linkedOrder: {
      items: [{ descriptor: { name: "Fast delivery" }, quantity: { count: 1, measure: { unit: "kilogram", value: 1 } }, price: { currency: "INR", value: "500.00" } }],
      provider: {
        descriptor: { name: "Store Name" },
        address: { name: "Store Name", building: "123", locality: "Sector 1", city: "Meerut", state: "Uttar Pradesh", area_code: "250001" },
      },
      order: {
        id: "retail-order-id-123",
        weight: { unit: "kilogram", value: 1 },
        dimensions: { length: { unit: "centimeter", value: 10 }, breadth: { unit: "centimeter", value: 10 }, height: { unit: "centimeter", value: 10 } },
      },
    },
  });
  const confirmed = await waitFor("6 on_confirm", "order_confirmed");
  const orderId: string = confirmed.orderId;
  log("6 on_confirm", `orderId=${orderId}`);
  if (!orderId) debug("6 on_confirm", "WARN order_confirmed event had no orderId — post-order steps will likely fail");
  const confirmedFulfillmentId = confirmed.fulfillment?.fulfillmentId ?? fulfillmentId;
  debug("6 on_confirm", `fulfillmentId=${confirmedFulfillmentId}${confirmed.fulfillment?.fulfillmentId ? "" : " (fallback from on_search)"}`);
  return {
    orderId,
    fulfillmentId: confirmedFulfillmentId,
    initTransactionId,
  };
}

/** Prints failure context (+ writes a JSON dump) unless FLOW_DEBUG=off. */
function reportFailure(error: unknown): void {
  console.error("[flow] FAILED:", error instanceof Error ? error.message : error);
  if (!debugOn) return;
  console.error(
    `[flow] failure context: flow=${flowName} step="${currentStep}" awaiting=${awaiting ? `"${awaiting}"` : "none"} clientId=${clientId} elapsed=${elapsed()}`,
  );
  if (error instanceof Error && error.stack) console.error(`[flow] stack:\n${error.stack}`);
  console.error(`[flow] buffered (unconsumed) events: ${bufferedNames()}`);
  const tail = received.slice(-FAILURE_EVENT_TAIL);
  console.error(`[flow] last ${tail.length} of ${received.length} SSE events:`);
  for (const e of tail) {
    console.error(`  +${((e.at - flowStarted) / 1000).toFixed(1)}s "${e.event}"${idSummary(e.data)} ${truncate(JSON.stringify(e.data), 300)}`);
  }
  try {
    const dir = join(process.cwd(), "reports", "flow-runs");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${flowName}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    const dump = {
      flow: flowName,
      clientId,
      baseUrl: BASE_URL,
      startedAt: new Date(flowStarted).toISOString(),
      failedAt: new Date().toISOString(),
      step: currentStep,
      awaiting,
      error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
      bufferedEvents: buffer,
      transcript,
    };
    writeFileSync(file, JSON.stringify(dump, null, 2));
    console.error(`[flow] debug dump written to ${file}`);
  } catch (dumpError) {
    console.error(`[flow] could not write debug dump: ${describeError(dumpError)}`);
  }
}

function failAndExit(error: unknown): never {
  if (!failing) {
    failing = true;
    reportFailure(error);
  }
  process.exit(1);
}

/** Opens the SSE stream, runs `flow`, exits 0 on success / 1 on failure. */
export async function runFlow(name: string, flow: () => Promise<void>): Promise<never> {
  flowName = name;
  process.on("unhandledRejection", (reason) => failAndExit(reason));
  try {
    if (debugOn) log("stream", `debug logging ${DEBUG_LEVEL} (set FLOW_DEBUG=off to disable, FLOW_DEBUG=full for payloads)`);
    await openStream();
    log("stream", `${name}: connected clientId=${clientId} base=${BASE_URL}`);
    await flow();
    log("done", "flow completed successfully");
    process.exit(0);
  } catch (error) {
    failAndExit(error);
  }
}
