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
} from "../mappers/confirm.mapper.js";

// Comparison helpers below back the state-consistency checks in
// validateAgainstInit: they verify a /confirm request agrees with the
// initialized (/init + /on_init) transaction rather than shape wire data,
// so they stay in the service rather than the mapper.
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
};
const same = (left: unknown, right: unknown) =>
  JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const itemIdentity = (items: unknown) =>
  Array.isArray(items)
    ? items.map((x: any) => ({
        id: x?.id,
        fulfillment_id: x?.fulfillment_id,
        category_id: x?.category_id,
      }))
    : items;

const requireSame = (incoming: any, initialized: any, path: string) => {
  if (incoming === undefined || incoming === null)
    throw new ConfirmValidationError("is required in confirm request", path);
  if (!same(incoming, initialized))
    throw new ConfirmValidationError(
      "does not match initialized transaction",
      path,
    );
};

const requireSameIfProvided = (
  incoming: any,
  initialized: any,
  path: string,
) => {
  if (incoming === undefined || incoming === null) return;
  if (!same(incoming, initialized))
    throw new ConfirmValidationError(
      "does not match initialized transaction",
      path,
    );
};

// Unlike items/billing/payment (which /confirm callers either omit entirely
// or resend in full), a /confirm fulfillment is expected to be a *partial*
// object carrying only the confirm-only fields (start.person/time,
// end.person, tags — see buildConfirmOrder) — it's not required to restate
// `type`. So identity is checked by `id` (must reference a real initialized
// fulfillment), and `type` is only cross-checked when the caller happens to
// include it, rather than requiring an exact {id,type} match for every entry.
const validateFulfillmentIdentity = (incoming: unknown, initialized: any[]) => {
  if (incoming === undefined || incoming === null) return;
  if (!Array.isArray(incoming))
    throw new ConfirmValidationError(
      "does not match initialized transaction",
      "message.order.fulfillments",
    );
  for (const supplied of incoming) {
    const match = initialized?.find((x: any) => x?.id === supplied?.id);
    if (!match)
      throw new ConfirmValidationError(
        "does not match initialized transaction",
        "message.order.fulfillments",
      );
    if (supplied?.type !== undefined && supplied.type !== match.type)
      throw new ConfirmValidationError(
        "does not match initialized transaction",
        "message.order.fulfillments",
      );
  }
};

const validateAgainstInit = (incoming: any, initialized: any) => {
  requireSameIfProvided(
    incoming.provider?.id,
    initialized.provider?.id,
    "message.order.provider.id",
  );
  requireSameIfProvided(
    incoming.provider?.locations?.map((x: any) => x?.id),
    initialized.provider?.locations?.map((x: any) => x?.id),
    "message.order.provider.locations",
  );
  requireSameIfProvided(
    itemIdentity(incoming.items),
    itemIdentity(initialized.items),
    "message.order.items",
  );
  validateFulfillmentIdentity(incoming.fulfillments, initialized.fulfillments);
  requireSameIfProvided(
    incoming.quote,
    initialized.quote,
    "message.order.quote",
  );
  requireSameIfProvided(
    incoming.billing,
    initialized.billing,
    "message.order.billing",
  );
  requireSameIfProvided(
    incoming.payment,
    initialized.payment,
    "message.order.payment",
  );
  // No consistency check against `initialized` for @ondc/org/linked_order:
  // unlike quote/billing/payment, it is never present in /init or /on_init
  // (see buildConfirmOrder) — it's supplied for the first time at /confirm,
  // so there is nothing prior to compare it against.
};

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
      hasOrderSupplement: Boolean(input.message?.order ?? input.order),
    });
    const state = await this.dependencies.repository.loadInitialized(
      input.initTransactionId,
    );
    const initOrder = state.init.message.order as any;
    const onInitOrder = state.onInit.message?.order as any;
    const initialized = mergeInitializedOrder(initOrder, onInitOrder) as any;
    const initializedState = {
      ...state.init,
      message: { ...state.init.message, order: initialized },
    } as any;
    const suppliedOrder = (input.message?.order ?? input.order ?? {}) as any;
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

    if (
      input.context?.transaction_id !== undefined &&
      input.context.transaction_id !== initTransactionId
    ) {
      throw new ConfirmValidationError(
        "must match initialized transaction_id",
        "context.transaction_id",
      );
    }
    if (input.context?.message_id === state.init.context.message_id) {
      throw new ConfirmValidationError(
        "must be unique for confirm",
        "context.message_id",
      );
    }
    if (!initialized.quote)
      throw new ConfirmValidationError(
        "initialized order quote is required",
        "message.order.quote",
      );

    const requestItems = suppliedOrder?.items;
    const initializedItems = initializedState?.message?.order?.items;
    const itemsMatch = same(
      itemIdentity(requestItems),
      itemIdentity(initializedItems),
    );

    console.log("CONFIRM initTransactionId:", initTransactionId);
    console.log(
      "CONFIRM request items:",
      JSON.stringify(requestItems, null, 2),
    );
    console.log(
      "INITIALIZED transaction items:",
      JSON.stringify(initializedItems, null, 2),
    );
    console.log(
      "INITIALIZED transaction:",
      initializedState?.context?.transaction_id,
    );
    console.log({
      requestItems,
      initializedItems,
      itemsMatch,
      requestComparableItems: itemIdentity(requestItems),
      initializedComparableItems: itemIdentity(initializedItems),
    });
    validateAgainstInit(suppliedOrder, initialized);

    if (
      suppliedOrder.id !== undefined &&
      state.orderId !== undefined &&
      suppliedOrder.id !== state.orderId
    ) {
      throw new ConfirmValidationError(
        "must reuse initialized confirm order.id",
        "message.order.id",
      );
    }
    const orderId = suppliedOrder.id ?? state.orderId ?? generateOrderId();
    const now = new Date().toISOString();
    // Items/provider/quote/billing/payment come from the initialized
    // transaction (post consistency checks above); fulfillments and
    // @ondc/org/linked_order fold in the confirm-only fields the caller
    // supplies (see buildConfirmOrder for why — they don't exist in /init).
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
      messageId: (input.context?.message_id as string) ?? randomUUID(),
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

  async handleCallback(response: any) {
    console.log("[confirm.service] handling /on_confirm", {
      transactionId: response.context.transaction_id,
      messageId: response.context.message_id,
    });
    return this.dependencies.repository.handleCallback(response);
  }
}
