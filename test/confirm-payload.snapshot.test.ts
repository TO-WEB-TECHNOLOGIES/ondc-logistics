import assert from "node:assert/strict";
import test from "node:test";
import { ConfirmService } from "../src/services/confirm.service.ts";

const order = {
  provider: { id: "P1", locations: [{ id: "L1" }] },
  items: [{ id: "I1", fulfillment_id: "F1", category_id: "Standard Delivery", descriptor: { code: "P2P" }, time: { label: "TAT", duration: "PT45M", timestamp: "2026-08-31T10:00:00.000Z" } }],
  fulfillments: [{ id: "F1", type: "Delivery", start: { location: { gps: "12.1,77.1", address: { name: "Store", building: "Building", locality: "Locality", city: "Bengaluru", state: "Karnataka", country: "India", area_code: "560001" } }, contact: { phone: "9000000000", email: "store@example.com" }, time: { duration: "PT15M" }, person: { name: "Pickup Agent" } }, end: { location: { gps: "12.2,77.2", address: { name: "Home", building: "House", locality: "Locality", city: "Bengaluru", state: "Karnataka", country: "India", area_code: "560002" } }, contact: { phone: "9111111111", email: "buyer@example.com" }, time: { duration: "PT30M" }, person: { name: "Delivery Agent" } } }],
  quote: { price: { currency: "INR", value: "59.00" }, breakup: [{ "@ondc/org/item_id": "I1", "@ondc/org/title_type": "delivery", price: { currency: "INR", value: "59.00" } }] },
  billing: { name: "Buyer", address: { name: "Home", building: "House", locality: "Locality", city: "Bengaluru", state: "Karnataka", country: "India", area_code: "560002" }, tax_number: "GST123", phone: "9111111111", email: "buyer@example.com", created_at: "2026-08-31T10:00:00.000Z", updated_at: "2026-08-31T10:00:00.000Z" },
  payment: { "@ondc/org/collection_amount": "59.00", collected_by: "BPP", type: "ON-FULFILLMENT", "@ondc/org/settlement_details": [{ settlement_counterparty: "lbnp", settlement_type: "upi" }] },
  "@ondc/org/linked_order": { items: [{ descriptor: { name: "Item" }, quantity: { count: 1, measure: { unit: "kilogram", value: 1 } }, price: { currency: "INR", value: "100.00" } }], provider: { descriptor: { name: "Retail Store" }, address: { name: "Store", building: "Building", locality: "Locality", city: "Bengaluru", state: "Karnataka", area_code: "560001" } }, order: { id: "RETAIL-1", weight: { unit: "kilogram", value: 1 }, dimensions: { length: { unit: "centimeter", value: 1 }, breadth: { unit: "centimeter", value: 1 }, height: { unit: "centimeter", value: 1 } } } }
};

test("confirm snapshot contains final ONDC fulfillment and billing paths", async () => {
  let sent: any;
  const service = new ConfirmService({
    repository: {
      async loadInitialized() { return { initTransactionId: "TX-1", init: { context: { domain: "nic2004:60232", country: "IND", city: "std:080", action: "init", core_version: "1.2.0", bap_id: "bap.example", bap_uri: "https://bap.example", bpp_id: "lsp.example", bpp_uri: "https://lsp.example", transaction_id: "TX-1", message_id: "M-1", timestamp: "2026-08-31T09:00:00.000Z", ttl: "PT30S" }, message: { order } } as any, onInit: { context: { action: "on_init", transaction_id: "TX-1" }, message: { order } } as any }; },
      async create() {}, async updateStatus() {}, async handleCallback() { return "processed" as const; }
    },
    transport: { async sendSearch() {}, async sendInit() {}, async sendConfirm(payload: any) { sent = payload; } }
  });
  await service.createConfirm({ initTransactionId: "TX-1", order: { fulfillments: order.fulfillments, items: order.items, billing: order.billing, payment: order.payment, "@ondc/org/linked_order": order["@ondc/org/linked_order"] } });
  assert.equal(sent.context.action, "confirm");
  const fulfillment = sent.message.order.fulfillments[0];
  assert.deepEqual(fulfillment.start.location, order.fulfillments[0].start.location);
  assert.deepEqual(fulfillment.start.contact, order.fulfillments[0].start.contact);
  assert.deepEqual(fulfillment.end.location, order.fulfillments[0].end.location);
  assert.deepEqual(fulfillment.end.contact, order.fulfillments[0].end.contact);
  assert.equal(sent.message.order.billing.tax_number, "GST123");
  assert.equal(sent.message.order.billing.created_at, order.billing.created_at);
  assert.equal(sent.message.order.billing.updated_at, order.billing.updated_at);
});
