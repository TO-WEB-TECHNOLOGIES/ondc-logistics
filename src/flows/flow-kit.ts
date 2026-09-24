/**
 * Shared helpers for the standalone workbench flow runners in src/flows.
 * Every flow runs against the deployed Render service, sends each request,
 * then waits for the matching callback event on the unified SSE stream
 * GET /logistics/stream/:clientId before moving on.
 *
 * Env knobs:
 *   FLOW_DEBUG=off | 0 | false   step logs + failure box + step summary only
 *   (unset)                      + timestamps, every SSE event with ids, wait heartbeats,
 *                                recent-event timeline and JSON dump in reports/flow-runs/
 *   FLOW_DEBUG=full | 1 | true   + full request/response/event payloads and stack traces
 *   FLOW_STEP_DELAY_MS           pause after a callback before the next request (default 3000)
 *                                — gives the server time to ACK the callback to the workbench,
 *                                like the natural delay between clicks in Postman
 *   FLOW_WAIT_TIMEOUT_MS         overrides every SSE wait limit (defaults: 120s for callbacks
 *                                answering our request, 600s for workbench-pushed events)
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { styleText } from "node:util";

export const BASE_URL = "https://ondc-logistics.onrender.com";
export const clientId = randomUUID();

type DebugLevel = "off" | "on" | "full";

function parseDebugLevel(raw: string | undefined): DebugLevel {
  const value = (raw ?? "").trim().toLowerCase();
  if (["off", "0", "false", "no"].includes(value)) return "off";
  if (["full", "1", "true", "verbose"].includes(value)) return "full";
  return "on";
}

function envMs(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export const DEBUG_LEVEL = parseDebugLevel(process.env.FLOW_DEBUG);
const debugOn = DEBUG_LEVEL !== "off";
const debugFull = DEBUG_LEVEL === "full";

const STEP_DELAY_MS = envMs("FLOW_STEP_DELAY_MS", 3_000);
const REPLY_WAIT_MS = envMs("FLOW_WAIT_TIMEOUT_MS", 120_000);
export const PUSH_WAIT_MS = envMs("FLOW_WAIT_TIMEOUT_MS", 600_000);
/** Events the workbench pushes on its own schedule rather than in reply to our request. */
const PUSHED_EVENTS = new Set(["order_status"]);
const RETRY_DELAY_MS = 5_000;
/** Server-side axios limit for outbound ONDC calls (src/utils/v1/axios.ts). */
const OUTBOUND_TIMEOUT_MS = 30_000;
const WAIT_HEARTBEAT_MS = 30_000;
const FAILURE_EVENT_TAIL = 8;

// ─── Pretty output ───────────────────────────────────────────────────────────

type Style = Parameters<typeof styleText>[0];
const useColor = !!process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (style: Style, text: string) => (useColor ? styleText(style, text) : text);

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const elapsed = (from = flowStarted) => secs(Date.now() - from);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const truncate = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}... (${text.length} chars)` : text;

const stamp = () =>
  debugOn ? paint("gray", `${new Date().toISOString().slice(11, 23)} +${elapsed().padStart(6)} `) : "";

const line = (icon: string, step: string, msg: string) =>
  console.log(`${stamp()}${icon} ${paint("bold", step.padEnd(20))} ${msg}`);

export const log = (step: string, msg: string) => line(paint("cyan", "•"), step, msg);

/** Dim diagnostic line; suppressed when FLOW_DEBUG=off. */
const debug = (step: string, msg: string) => {
  if (debugOn) line(paint("gray", "·"), step, paint("gray", msg));
};

const warn = (step: string, msg: string) => line(paint("yellow", "!"), step, paint("yellow", msg));

/** Full pretty-printed payload; only when FLOW_DEBUG=full. */
const dumpPayload = (step: string, label: string, data: unknown) => {
  if (debugFull) debug(step, `${label}:\n${JSON.stringify(data, null, 2)}`);
};

// ─── State ───────────────────────────────────────────────────────────────────

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

interface StepResult {
  step: string;
  what: string;
  ok: boolean;
  durationMs: number;
}

interface FlowErrorInit {
  details?: [string, string][];
  hint?: string;
  retryable?: boolean;
}

/** An expected, already-explained flow failure: printed as a box, no stack trace. */
class FlowError extends Error {
  readonly details: [string, string][];
  readonly hint?: string;
  readonly retryable: boolean;

  constructor(
    readonly step: string,
    message: string,
    init: FlowErrorInit = {},
  ) {
    super(message);
    this.name = "FlowError";
    this.details = init.details ?? [];
    this.hint = init.hint;
    this.retryable = init.retryable ?? false;
  }
}

const buffer: StreamEvent[] = [];
let notify: (() => void) | undefined;

const flowStarted = Date.now();
let flowName = "flow";
let currentStep = "stream";
let awaiting: string | undefined;
let lastEventAt: number | undefined;
let lastCallbackAt: number | undefined;
let failing = false;
const received: ReceivedEvent[] = [];
const transcript: TranscriptEntry[] = [];
const steps: StepResult[] = [];

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

/** Picks well-known correlation ids/states out of a payload (top level + `context`) as "k=v k=v". */
function ids(data: unknown): string {
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
  return parts.join(" ");
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as Error & { cause?: unknown }).cause;
  return cause ? `${error.message} (cause: ${describeError(cause)})` : error.message;
}

const bufferedNames = () => (buffer.length ? buffer.map((e) => e.event).join(", ") : "none");

// ─── SSE stream ──────────────────────────────────────────────────────────────

export async function openStream(): Promise<void> {
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/logistics/stream/${clientId}`);
  } catch (error) {
    throw new FlowError("stream", "could not open the SSE stream", {
      details: [
        ["request", `GET ${BASE_URL}/logistics/stream/${clientId}`],
        ["after", elapsed(started)],
        ["cause", describeError(error)],
      ],
      hint: "Network failure before any HTTP response — check connectivity, or the Render service may be cold-starting/redeploying.",
    });
  }
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new FlowError("stream", `SSE stream returned HTTP ${res.status}`, {
      details: text ? [["body", truncate(text, 400)]] : [],
      hint: res.status >= 500 ? "Render may still be starting — wait a minute and rerun." : undefined,
    });
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
        return failAndExit(
          new FlowError(currentStep, "SSE stream read error", {
            details: [["cause", describeError(error)]],
            hint: "The connection to the server dropped. Nothing is replayed on reconnect — rerun the flow.",
          }),
        );
      }
      const { done, value } = chunk;
      if (done) {
        const since = lastEventAt ? `${elapsed(lastEventAt)} after the last event` : "before any event arrived";
        return failAndExit(
          new FlowError(currentStep, "SSE stream closed by the server", {
            details: [["when", since]],
            hint: "The server restarted/redeployed or a proxy dropped the connection. Nothing is replayed on reconnect — rerun the flow.",
          }),
        );
      }
      pending += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = pending.indexOf("\n\n")) !== -1) {
        const block = pending.slice(0, idx);
        pending = pending.slice(idx + 2);
        let event = "message";
        let data = "";
        for (const l of block.split("\n")) {
          if (l.startsWith("event:")) event = l.slice(6).trim();
          else if (l.startsWith("data:")) data += l.slice(5).trim();
        }
        if (!data) continue; // comments / heartbeats
        let parsed: Record<string, any>;
        try {
          parsed = JSON.parse(data);
        } catch (error) {
          warn(currentStep, `SSE "${event}" has invalid JSON (${describeError(error)}): ${truncate(data, 300)}`);
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
  const note = awaited ? "" : awaiting ? ` (buffered; waiting for "${awaiting}")` : " (buffered)";
  line(paint("magenta", "⇠"), currentStep, `${paint("magenta", event)} ${paint("gray", ids(data) + note)}`);
  dumpPayload(currentStep, `"${event}" payload`, data);
}

// ─── Waiting ─────────────────────────────────────────────────────────────────

export interface WaitOptions {
  /** Overrides the default limit (120s for replies, 600s for workbench-pushed events). */
  timeoutMs?: number;
}

/** Waits for the next `event` (with a timeout); any `<x>_error` event aborts the flow. */
export async function waitFor(step: string, event: string, options: WaitOptions = {}): Promise<Record<string, any>> {
  currentStep = step;
  awaiting = event;
  const timeoutMs = options.timeoutMs ?? (PUSHED_EVENTS.has(event) ? PUSH_WAIT_MS : REPLY_WAIT_MS);
  line(paint("gray", "…"), step, paint("gray", `waiting for "${event}" (timeout ${secs(timeoutMs)})`));
  if (buffer.length) debug(step, `already buffered: ${bufferedNames()}`);
  const started = Date.now();
  const deadline = started + timeoutMs;
  const heartbeat = debugOn
    ? setInterval(() => {
        const last = lastEventAt ? `${elapsed(lastEventAt)} ago` : "never";
        debug(step, `still waiting for "${event}" (${elapsed(started)} / ${secs(timeoutMs)}) · buffered: ${bufferedNames()} · last SSE event ${last}`);
      }, WAIT_HEARTBEAT_MS)
    : undefined;
  let timer: NodeJS.Timeout | undefined;
  const fail = (message: string, init: FlowErrorInit): never => {
    steps.push({ step, what: `SSE ${event}`, ok: false, durationMs: Date.now() - started });
    throw new FlowError(step, message, init);
  };
  try {
    for (;;) {
      const errIdx = buffer.findIndex((e) => e.event.endsWith("_error"));
      if (errIdx !== -1) {
        const [err] = buffer.splice(errIdx, 1);
        dumpPayload(step, `"${err!.event}" error payload`, err!.data);
        const { code, message } = err!.data;
        fail(`server sent "${err!.event}" instead of "${event}"`, {
          details: [
            ["error", [code, message].filter(Boolean).join(" — ") || truncate(JSON.stringify(err!.data), 300)],
            ["ids", ids(err!.data) || "-"],
          ],
          hint: "The LSP/workbench answered with an ONDC error callback — the code/message above comes from it.",
        });
      }
      const idx = buffer.findIndex((e) => e.event === event);
      if (idx !== -1) {
        const [hit] = buffer.splice(idx, 1);
        const durationMs = Date.now() - started;
        line(paint("green", "✓"), step, `${paint("green", event)} ${paint("gray", `(${secs(durationMs)})`)}`);
        steps.push({ step, what: `SSE ${event}`, ok: true, durationMs });
        lastCallbackAt = Date.now();
        return hit!.data;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        fail(`timed out after ${secs(timeoutMs)} waiting for "${event}"`, {
          details: [
            ["buffered", bufferedNames()],
            ["last SSE", lastEventAt ? `${elapsed(lastEventAt)} ago` : "no event received yet"],
          ],
          hint: PUSHED_EVENTS.has(event) || options.timeoutMs
            ? "The workbench never pushed this event. Check the workbench run for this transaction; raise FLOW_WAIT_TIMEOUT_MS if it is just slow."
            : 'The callback never reached this client. Check the server logs for the callback and for "[client-stream] pushing event ... delivered: false".',
        });
      }
      await new Promise<void>((resolve) => {
        notify = resolve;
        timer = setTimeout(resolve, remaining);
      });
      clearTimeout(timer);
    }
  } finally {
    clearInterval(heartbeat);
    clearTimeout(timer);
    awaiting = undefined;
  }
}

/** Waits until `count` events named `event` have arrived, returning them in order. */
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

// ─── Requests ────────────────────────────────────────────────────────────────

/** Pauses after a callback so the server can ACK it to the workbench before our next request. */
async function settle(step: string): Promise<void> {
  if (lastCallbackAt === undefined) return;
  const remaining = STEP_DELAY_MS - (Date.now() - lastCallbackAt);
  lastCallbackAt = undefined;
  if (remaining <= 0) return;
  debug(step, `pausing ${secs(remaining)} so the server can ACK the previous callback`);
  await sleep(remaining);
}

function httpHint(status: number, durationMs: number): string | undefined {
  if (status >= 500 && durationMs >= OUTBOUND_TIMEOUT_MS - 1_000 && durationMs <= OUTBOUND_TIMEOUT_MS + 15_000) {
    return "Took ~30s: the server's outbound call to the ONDC gateway/workbench most likely hit its 30s axios timeout (src/utils/v1/axios.ts). The workbench did not answer in time — it may be busy with a previous run or still waiting on a callback ACK. Check the server logs for this transaction.";
  }
  if (status >= 500) return "Server-side failure — check the Render service logs around this timestamp.";
  if (status === 409) return "The request does not match the stored transaction/order state — an earlier callback may not be persisted yet, or ids from an earlier step are wrong.";
  if (status === 400) return "The server rejected the request body — compare it with the Postman collection.";
  if (status === 404) return "Unknown route or id — check BASE_URL and the ids carried over from earlier steps.";
  return undefined;
}

export interface PostOptions {
  /** Extra attempts after a 5xx/network failure. Only safe for requests that start a new transaction. */
  retries?: number;
}

export async function post(
  step: string,
  path: string,
  body: unknown,
  options: PostOptions = {},
): Promise<Record<string, any>> {
  currentStep = step;
  await settle(step);
  const attempts = 1 + (options.retries ?? 0);
  const started = Date.now();
  for (let attempt = 1; ; attempt++) {
    try {
      const { json, status } = await postOnce(step, path, body);
      steps.push({ step, what: `POST ${path} → ${status}`, ok: true, durationMs: Date.now() - started });
      return json;
    } catch (error) {
      if (error instanceof FlowError && error.retryable && attempt < attempts) {
        warn(step, `${error.message} — retrying in ${secs(RETRY_DELAY_MS)} (attempt ${attempt + 1}/${attempts})`);
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      steps.push({ step, what: `POST ${path}`, ok: false, durationMs: Date.now() - started });
      throw error;
    }
  }
}

async function postOnce(step: string, path: string, body: unknown): Promise<{ json: Record<string, any>; status: number }> {
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
    throw new FlowError(step, `POST ${path} could not reach the server`, {
      details: [
        ["after", elapsed(started)],
        ["cause", describeError(error)],
      ],
      hint: "Network failure before any HTTP response — check connectivity, or the Render service may be cold-starting/redeploying.",
      retryable: true,
    });
  }
  const durationMs = Date.now() - started;
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
  record({ kind: "response", step, method: "POST", path, status: res.status, durationMs, body: isJson ? json : text });
  if (!res.ok) {
    const err = isJson && json.error && typeof json.error === "object" ? (json.error as Record<string, any>) : undefined;
    const details: [string, string][] = [["response", `HTTP ${res.status} after ${secs(durationMs)}`]];
    if (err?.code || err?.message) details.push(["error", [err.code, err.message].filter(Boolean).join(" — ")]);
    if (err?.path) details.push(["path", String(err.path)]);
    if (Array.isArray(err?.details) && err.details.length) details.push(["details", truncate(JSON.stringify(err.details), 400)]);
    if (!err) details.push(["body", truncate(isJson ? JSON.stringify(json) : text || "(empty)", 400)]);
    throw new FlowError(step, `POST ${path} failed`, {
      details,
      hint: httpHint(res.status, durationMs),
      retryable: res.status >= 500,
    });
  }
  if (!isJson) debug(step, `non-JSON response body: ${truncate(text, 300)}`);
  const idText = ids(json);
  line(
    paint("blue", "→"),
    step,
    `POST ${path} ${paint("green", String(res.status))} ${paint("gray", `(${secs(durationMs)})${idText ? ` ${idText}` : ""}`)}`,
  );
  dumpPayload(step, `POST ${path} response body`, json);
  return { json, status: res.status };
}

// ─── Shared pre-order steps ──────────────────────────────────────────────────

export interface ConfirmedOrder {
  orderId: string;
  fulfillmentId: string;
  initTransactionId: string;
}

/** Steps 1-6: SEARCH, ON_SEARCH, INIT, ON_INIT, CONFIRM, ON_CONFIRM. */
export async function runSearchInitConfirm(): Promise<ConfirmedOrder> {
  // Search starts a fresh transaction on every attempt, so one retry is safe.
  const search = await post(
    "1 search",
    "/logistics/search",
    {
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
    },
    { retries: 1 },
  );
  const searchResult = await waitFor("2 on_search", "search_result");
  const searchId: string = searchResult.searchId ?? search.searchId;
  const provider = searchResult.provider;
  if (!provider?.providerId) {
    throw new FlowError("2 on_search", "search_result has no provider.providerId", {
      details: [["payload", truncate(JSON.stringify(searchResult), 600)]],
    });
  }
  const providerId: string = provider.providerId;
  const item = provider.items?.find((i: any) => i.fulfillmentId) ?? provider.items?.[0];
  if (!item?.catalogItemId) {
    throw new FlowError("2 on_search", "search_result provider has no usable items[].catalogItemId", {
      details: [["provider", truncate(JSON.stringify(provider), 600)]],
    });
  }
  const itemId: string = item.catalogItemId;
  const fulfillmentId: string = item.fulfillmentId ?? provider.fulfillments?.[0]?.fulfillmentId;
  log("2 on_search", `provider=${providerId} item=${itemId} fulfillment=${fulfillmentId}`);
  debug("2 on_search", `searchId=${searchId} items=${provider.items?.length ?? 0} fulfillments=${provider.fulfillments?.length ?? 0}`);
  if (!fulfillmentId) warn("2 on_search", "no fulfillmentId on item or provider.fulfillments[0] — init will be sent without one");

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
    payment: {
      type: "ON-ORDER",
      collected_by: "BAP",
      amount: "120.00",
      currency: "INR",
      settlement_details: [
        {
          settlement_counterparty: "buyer-app",
          settlement_type: "upi",
          beneficiary_name: "Buyer App Pvt Ltd",
          upi_address: "buyerapp@oksbi",
          settlement_bank_account_no: "1234567890",
          settlement_ifsc_code: "SBIN0000001",
        },
      ],
    },
  });
  await waitFor("4 on_init", "init_result");
  const initTransactionId: string = init.transactionId;
  debug("4 on_init", `initTransactionId=${initTransactionId}`);
  if (!initTransactionId) warn("4 on_init", "/logistics/init response had no transactionId — confirm will likely fail");

  await post("5 confirm", "/logistics/confirm", {
    initTransactionId,
    fulfillments: [
      {
        id: "1",
        // Contract: start code "2" carries the PCC, end code "3" the DCC, in short_desc.
        start: {
          instructions: {
            code: "2",
            short_desc: "123456",
            long_desc: "additional instructions for pickup",
            additional_desc: { content_type: "text/html", url: "https://example.com/pickup_instructions.htm" },
          },
        },
        end: { instructions: { code: "3", short_desc: "654321", long_desc: "additional instructions for delivery" } },
        tags: [{ code: "state", list: [{ code: "ready_to_ship", value: "yes" }] }],
      },
    ],
    linkedOrder: {
      items: [{ category_id: "Grocery", descriptor: { name: "Fast delivery" }, quantity: { count: 1, measure: { unit: "kilogram", value: 1 } }, price: { currency: "INR", value: "500.00" } }],
      provider: {
        descriptor: { name: "Store Name" },
        address: { name: "Store Name", building: "123", locality: "Sector 1", city: "Meerut", state: "Uttar Pradesh", country: "IND", area_code: "250001" },
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
  if (!orderId) warn("6 on_confirm", "order_confirmed event had no orderId — post-order steps will likely fail");
  const confirmedFulfillmentId = confirmed.fulfillment?.fulfillmentId ?? fulfillmentId;
  debug("6 on_confirm", `fulfillmentId=${confirmedFulfillmentId}${confirmed.fulfillment?.fulfillmentId ? "" : " (fallback from on_search)"}`);
  return {
    orderId,
    fulfillmentId: confirmedFulfillmentId,
    initTransactionId,
  };
}

// ─── Reporting ───────────────────────────────────────────────────────────────

function printSummary(write: (text: string) => void): void {
  if (!steps.length) return;
  write(paint("bold", "\nSteps"));
  for (const s of steps) {
    const icon = s.ok ? paint("green", "✓") : paint("red", "✗");
    write(`  ${icon} ${s.step.padEnd(22)} ${s.what.padEnd(36)} ${paint("gray", secs(s.durationMs).padStart(7))}`);
  }
}

/** Prints a failure box + step summary; with debug on, also recent events and a JSON dump. */
function reportFailure(error: unknown): void {
  const flowError = error instanceof FlowError ? error : undefined;
  const bar = paint("red", "│");
  const row = (key: string, value: string) => `${bar} ${paint("gray", key.padEnd(9))} ${value}`;
  const out: string[] = [
    "",
    `${paint(["bold", "red"], "✗ FLOW FAILED")}  ${paint("bold", flowError?.step ?? currentStep)}  ${paint("gray", `${flowName} · +${elapsed()}`)}`,
    `${bar} ${flowError ? flowError.message : describeError(error)}`,
  ];
  for (const [key, value] of flowError?.details ?? []) out.push(row(key, value));
  if (!flowError && error instanceof Error && error.stack) {
    // Unexpected script bug: point at the first frame instead of dumping the whole stack.
    const frame = error.stack.split("\n").find((l) => l.trim().startsWith("at "));
    if (frame) out.push(row("where", frame.trim().replace(/^at /, "")));
  }
  if (flowError?.hint) out.push(`${bar} ${paint("yellow", "hint".padEnd(9))} ${paint("yellow", flowError.hint)}`);
  out.push(row("clientId", clientId));
  console.error(out.join("\n"));
  if (debugFull && error instanceof Error && error.stack) console.error(paint("gray", error.stack));

  printSummary(console.error);
  if (!debugOn) return;

  const tail = received.slice(-FAILURE_EVENT_TAIL);
  if (tail.length) {
    console.error(paint("bold", `\nRecent SSE events (last ${tail.length} of ${received.length})`));
    for (const e of tail) {
      console.error(`  ${paint("gray", `+${secs(e.at - flowStarted)}`.padStart(8))} ${e.event.padEnd(22)} ${paint("gray", ids(e.data))}`);
    }
  }
  if (buffer.length) console.error(paint("gray", `Unconsumed events: ${bufferedNames()}`));

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
      step: flowError?.step ?? currentStep,
      awaiting,
      error: error instanceof Error
        ? { message: error.message, details: flowError?.details, hint: flowError?.hint, stack: error.stack }
        : String(error),
      steps,
      bufferedEvents: buffer,
      transcript,
    };
    writeFileSync(file, JSON.stringify(dump, null, 2));
    console.error(paint("gray", `\nDebug dump: ${file}`));
  } catch (dumpError) {
    console.error(paint("gray", `\nCould not write debug dump: ${describeError(dumpError)}`));
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
    debug(
      "config",
      `debug=${DEBUG_LEVEL} stepDelay=${secs(STEP_DELAY_MS)} replyTimeout=${secs(REPLY_WAIT_MS)} pushTimeout=${secs(PUSH_WAIT_MS)}`,
    );
    await openStream();
    log("stream", `${name}: connected clientId=${clientId} base=${BASE_URL}`);
    await flow();
    line(paint("green", "✓"), "done", paint(["bold", "green"], `flow completed in ${elapsed()}`));
    printSummary(console.log);
    process.exit(0);
  } catch (error) {
    failAndExit(error);
  }
}
