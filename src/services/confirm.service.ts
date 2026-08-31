import { randomUUID } from "node:crypto";
import type { ConfirmRequest, ConfirmResponse } from "../types/confirm/internal.js";
import type { OndcConfirmRequest, OndcConfirmOrder } from "../types/confirm/ondc.js";
import type { OndcTransport } from "../utils/ondc-transport.js";
import type { ConfirmRepository } from "../repositories/confirm.repository.js";
import { ConfirmValidationError, validateConfirmPayload } from "../utils/confirm-validation.js";

const withBapAcceptance = (tags: unknown) => {
  const list = Array.isArray(tags) ? tags.map((x: any) => ({ ...x, list: Array.isArray(x?.list) ? [...x.list] : [] })) : [];
  const existing = list.find((x: any) => x.code === "bap_terms");
  if (existing) { existing.list = existing.list.filter((x: any) => x.code !== "accept_bpp_terms"); existing.list.push({ code: "accept_bpp_terms", value: "Y" }); }
  else list.push({ code: "bap_terms", list: [{ code: "accept_bpp_terms", value: "Y" }] });
  return list;
};

const mergeById = (stored: any[], supplied: unknown, immutableKeys: string[]) => {
  if (!Array.isArray(supplied)) return stored;
  return stored.map((item: any, index: number) => {
    const extra = (supplied[index] && typeof supplied[index] === "object" ? supplied[index] : {}) as any;
    const match = supplied.find((candidate: any) => candidate?.id === item.id);
    const supplement = match ?? extra;
    const result = { ...item, ...supplement };
    for (const key of immutableKeys) result[key] = item[key];
    return result;
  });
};

export class ConfirmService {
  constructor(private readonly dependencies: { transport: OndcTransport; repository: ConfirmRepository }) {}

  async createConfirm(input: ConfirmRequest): Promise<ConfirmResponse> {
    console.log("[confirm.service] createConfirm invoked", { initTransactionId: input.initTransactionId, hasOrderSupplement: Boolean(input.order) });
    const state = await this.dependencies.repository.loadInitialized(input.initTransactionId);
    const stored = (state.onInit.message?.order ?? state.init.message.order) as any;
    const supplement = (input.order ?? {}) as any;
    const orderId = randomUUID();
    const now = new Date().toISOString();
    if (!stored.quote) throw new ConfirmValidationError("initialized order quote is required", "message.order.quote");

    const order: OndcConfirmOrder = {
      ...stored,
      ...supplement,
      id: orderId,
      state: "Created",
      created_at: supplement.created_at ?? stored.created_at ?? now,
      updated_at: now,
      provider: stored.provider,
      items: mergeById(stored.items, supplement.items, ["id", "fulfillment_id"]),
      fulfillments: mergeById(stored.fulfillments, supplement.fulfillments, ["id", "type"]),
      quote: stored.quote,
      billing: supplement.billing ?? stored.billing ?? state.init.message.order.billing,
      payment: supplement.payment ?? stored.payment ?? state.init.message.order.payment,
      "@ondc/org/linked_order": supplement["@ondc/org/linked_order"] ?? stored["@ondc/org/linked_order"],
      tags: withBapAcceptance(supplement.tags ?? stored.tags),
    } as OndcConfirmOrder;

    const payload: OndcConfirmRequest = {
      context: { ...state.init.context, action: "confirm", message_id: randomUUID(), timestamp: now },
      message: { order },
    };
    validateConfirmPayload(payload);
    console.log("[confirm.service] final ONDC /confirm payload", JSON.stringify(payload, null, 2));
    await this.dependencies.repository.create(payload, state.initTransactionId);
    try {
      console.log("[confirm.service] sending /confirm", { orderId, transactionId: payload.context.transaction_id, messageId: payload.context.message_id, bppId: payload.context.bpp_id, bppUri: payload.context.bpp_uri });
      await this.dependencies.transport.sendConfirm(payload);
      await this.dependencies.repository.updateStatus(payload.context.transaction_id, "sent");
      console.log("[confirm.service] /confirm sent", { orderId, transactionId: payload.context.transaction_id });
    } catch (error) {
      console.log("[confirm.service] /confirm failed", { orderId, transactionId: payload.context.transaction_id, error: error instanceof Error ? error.message : error });
      await this.dependencies.repository.updateStatus(payload.context.transaction_id, "failed", { code: "ONDC_SUBMISSION_FAILED", message: error instanceof Error ? error.message : "ONDC submission failed" });
      throw error;
    }
    return { orderId, transactionId: payload.context.transaction_id, messageId: payload.context.message_id, status: "CONFIRM_SENT" };
  }

  async handleCallback(response: any) {
    console.log("[confirm.service] handling /on_confirm", { transactionId: response.context.transaction_id, messageId: response.context.message_id });
    return this.dependencies.repository.handleCallback(response);
  }
}
