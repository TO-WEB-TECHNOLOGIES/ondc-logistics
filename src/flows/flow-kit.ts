/**
 * Shared helpers for the standalone workbench flow runners in src/flows.
 * Every flow runs against the deployed Render service, sends each request,
 * then waits (no timeout) for the matching callback event on the unified SSE
 * stream GET /logistics/stream/:clientId before moving on.
 */
import { randomUUID } from "node:crypto";

export const BASE_URL = "https://ondc-logistics.onrender.com";
export const clientId = randomUUID();

interface StreamEvent {
  event: string;
  data: Record<string, any>;
}

const buffer: StreamEvent[] = [];
let notify: (() => void) | undefined;

export const log = (step: string, msg: string) =>
  console.log(`[flow] ${step.padEnd(22)} ${msg}`);

export async function openStream(): Promise<void> {
  const res = await fetch(`${BASE_URL}/logistics/stream/${clientId}`);
  if (!res.ok || !res.body) throw new Error(`SSE connect failed: ${res.status}`);
  void (async () => {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        console.error("[flow] SSE stream closed by server");
        process.exit(1);
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
        buffer.push({ event, data: JSON.parse(data) });
        notify?.();
      }
    }
  })();
}

/** Waits (indefinitely) for the next `event`; any `<x>_error` event aborts the flow. */
export async function waitFor(step: string, event: string): Promise<Record<string, any>> {
  log(step, `waiting for SSE "${event}"...`);
  const started = Date.now();
  for (;;) {
    const errIdx = buffer.findIndex((e) => e.event.endsWith("_error"));
    if (errIdx !== -1) {
      const [err] = buffer.splice(errIdx, 1);
      throw new Error(`${step}: received ${err!.event} ${JSON.stringify(err!.data)}`);
    }
    const idx = buffer.findIndex((e) => e.event === event);
    if (idx !== -1) {
      const [hit] = buffer.splice(idx, 1);
      log(step, `PASS "${event}" (${((Date.now() - started) / 1000).toFixed(1)}s)`);
      return hit!.data;
    }
    await new Promise<void>((resolve) => (notify = resolve));
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
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok) throw new Error(`${step}: POST ${path} -> ${res.status} ${JSON.stringify(json)}`);
  log(step, `sent POST ${path} -> ${res.status}`);
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
      gps: "28.9845,77.7064",
      area_code: "250001",
      address: { name: "Pickup Person", building: "123", locality: "Sector 1", street: "Main Road", city: "Meerut", state: "Uttar Pradesh", country: "IND" },
    },
    end: {
      gps: "28.6139,77.2090",
      area_code: "110001",
      address: { name: "Delivery Person", building: "456", locality: "Connaught Place", street: "Main Road", city: "New Delhi", state: "Delhi", country: "IND" },
    },
    schedule: { days: "1,2,3,4,5,6,7", range_start: "0000", range_end: "2359" },
    payload: {
      weight: { value: 1, unit: "kilogram" },
      dimensions: { length: { value: 10, unit: "centimeter" }, breadth: { value: 10, unit: "centimeter" }, height: { value: 10, unit: "centimeter" } },
      category: "Grocery",
      value: { amount: "100", currency: "INR" },
      dangerous_goods: false,
    },
  });
  const searchResult = await waitFor("2 on_search", "search_result");
  const searchId: string = searchResult.searchId ?? search.searchId;
  const providerId: string = searchResult.provider.providerId;
  const item = searchResult.provider.items?.find((i: any) => i.fulfillmentId) ?? searchResult.provider.items?.[0];
  const itemId: string = item.catalogItemId;
  const fulfillmentId: string = item.fulfillmentId ?? searchResult.provider.fulfillments?.[0]?.fulfillmentId;
  log("2 on_search", `provider=${providerId} item=${itemId} fulfillment=${fulfillmentId}`);

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
  return {
    orderId,
    fulfillmentId: confirmed.fulfillment?.fulfillmentId ?? fulfillmentId,
    initTransactionId,
  };
}

/** Opens the SSE stream, runs `flow`, exits 0 on success / 1 on failure. */
export async function runFlow(name: string, flow: () => Promise<void>): Promise<never> {
  try {
    await openStream();
    log("stream", `${name}: connected clientId=${clientId} base=${BASE_URL}`);
    await flow();
    log("done", "flow completed successfully");
    process.exit(0);
  } catch (error) {
    console.error("[flow] FAILED:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
