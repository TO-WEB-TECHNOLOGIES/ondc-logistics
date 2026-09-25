import { randomUUID } from "node:crypto";
import { generateOrderId } from "../utils/order-id.js";
import type {
  ConfirmRequest,
  ConfirmResponse,
} from "../types/confirm/internal.js";
import type { OndcConfirmOrder } from "../types/confirm/ondc.js";
import type { OndcTransport } from "../utils/ondc-transport.js";
import type { ConfirmRepository } from "../repositories/confirm.repository.js";
import {
  ConfirmValidationError,
  validateConfirmPayload,
} from "../utils/confirm-validation.js";
import {
  buildConfirmOrder,
  buildConfirmPayload,
  mergeInitializedOrder,
  toSuppliedOrder,
} from "../mappers/confirm.mapper.js";
import type { CallbackStream } from "../utils/streams/callback-stream.js";

export class ConfirmService {
  constructor(
    private readonly dependencies: {
      transport: OndcTransport;
      repository: ConfirmRepository;
    },
  ) {}

  async createConfirm(input: ConfirmRequest): Promise<ConfirmResponse> {
    console.log("[confirm.service] createConfirm invoked", {
      initTransactionId: input.initTransactionId,
      hasLinkedOrder: Boolean(input.linkedOrder),
    });
    const state = await this.dependencies.repository.loadInitialized(
      input.initTransactionId,
    );
    const initOrder = state.init.message.order as any;
    const onInitOrder = state.onInit.message?.order as any;
    const initialized = mergeInitializedOrder(initOrder, onInitOrder) as any;
    const suppliedOrder = toSuppliedOrder(input);
    const initTransactionId = input.initTransactionId;

    if (
      initTransactionId !== state.initTransactionId ||
      initTransactionId !== state.init.context.transaction_id
    ) {
      throw new ConfirmValidationError(
        "must match initialized transaction_id",
        "initTransactionId",
      );
    }
    if (!initialized.quote)
      throw new ConfirmValidationError(
        "initialized order quote is required",
        "message.order.quote",
      );

    const orderId = state.orderId ?? generateOrderId();
    const now = new Date().toISOString();
    // Provider/items/fulfillments/quote/billing/payment come from the
    // initialized transaction; only @ondc/org/linked_order (if supplied)
    // folds in from the request — see buildConfirmOrder/toSuppliedOrder.
    const order: OndcConfirmOrder = buildConfirmOrder({
      initialized,
      suppliedOrder,
      orderId,
      now,
    });

    const payload = buildConfirmPayload({
      order,
      initContext: state.init.context,
      transactionId: initTransactionId,
      messageId: randomUUID(),
      now,
    });
    validateConfirmPayload(payload);
    console.log(
      "[confirm.service] final ONDC /confirm payload",
      JSON.stringify(payload, null, 10),
    );
    const created = await this.dependencies.repository.create(
      payload,
      state.initTransactionId,
    );
    if (!created) {
      console.log("[confirm.service] idempotent /confirm retry", {
        transactionId: payload.context.transaction_id,
        messageId: payload.context.message_id,
        orderId,
      });
      return {
        orderId,
        transactionId: payload.context.transaction_id,
        messageId: payload.context.message_id,
        status: "CONFIRM_SENT",
      };
    }
    try {
      console.log("[confirm.service] sending /confirm", {
        orderId,
        transactionId: payload.context.transaction_id,
        messageId: payload.context.message_id,
        bppId: payload.context.bpp_id,
        bppUri: payload.context.bpp_uri,
      });
      await this.dependencies.transport.sendConfirm(payload);
      await this.dependencies.repository.updateStatus(
        payload.context.transaction_id,
        "sent",
      );
      console.log("[confirm.service] /confirm sent", {
        orderId,
        transactionId: payload.context.transaction_id,
      });
    } catch (error) {
      console.log("[confirm.service] /confirm failed", {
        orderId,
        transactionId: payload.context.transaction_id,
        error: error instanceof Error ? error.message : error,
      });
      await this.dependencies.repository.updateStatus(
        payload.context.transaction_id,
        "failed",
        {
          code: "ONDC_SUBMISSION_FAILED",
          message:
            error instanceof Error ? error.message : "ONDC submission failed",
        },
      );
      throw error;
    }
    return {
      orderId,
      transactionId: payload.context.transaction_id,
      messageId: payload.context.message_id,
      status: "CONFIRM_SENT",
    };
  }

  async handleCallback(response: any, stream?: CallbackStream) {
    console.log("[confirm.service] handling /on_confirm", {
      transactionId: response.context.transaction_id,
      messageId: response.context.message_id,
    });
    return this.dependencies.repository.handleCallback(response, stream);
  }
}
