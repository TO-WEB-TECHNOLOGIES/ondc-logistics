import { randomUUID } from "node:crypto";
import type {
  ConfirmRequest,
  ConfirmResponse,
} from "../types/confirm/internal.js";
import type {
  OndcConfirmRequest,
  OndcConfirmOrder,
} from "../types/confirm/ondc.js";
import type { OndcTransport } from "../utils/ondc-transport.js";
import type { ConfirmRepository } from "../repositories/confirm.repository.js";
import {
  ConfirmValidationError,
  validateConfirmPayload,
} from "../utils/confirm-validation.js";

const withBapAcceptance = (tags: unknown) => {
  const list = Array.isArray(tags)
    ? tags.map((x: any) => ({
        ...x,
        list: Array.isArray(x?.list) ? [...x.list] : [],
      }))
    : [];
  const existing = list.find((x: any) => x.code === "bap_terms");
  if (existing) {
    existing.list = existing.list.filter(
      (x: any) => x.code !== "accept_bpp_terms",
    );
    existing.list.push({ code: "accept_bpp_terms", value: "Y" });
  } else
    list.push({
      code: "bap_terms",
      list: [{ code: "accept_bpp_terms", value: "Y" }],
    });
  return list;
};

const mergeById = (
  stored: any[],
  supplied: unknown,
  immutableKeys: string[],
) => {
  if (!Array.isArray(supplied)) return stored;
  return stored.map((item: any, index: number) => {
    const extra = (
      supplied[index] && typeof supplied[index] === "object"
        ? supplied[index]
        : {}
    ) as any;
    const match = supplied.find((candidate: any) => candidate?.id === item.id);
    const supplement = match ?? extra;
    const result = { ...item, ...supplement };
    for (const key of immutableKeys) result[key] = item[key];
    return result;
  });
};

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
  requireSameIfProvided(
    incoming.fulfillments?.map((x: any) => ({ id: x?.id, type: x?.type })),
    initialized.fulfillments?.map((x: any) => ({ id: x?.id, type: x?.type })),
    "message.order.fulfillments",
  );
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
  requireSameIfProvided(
    incoming["@ondc/org/linked_order"],
    initialized["@ondc/org/linked_order"],
    "message.order.@ondc/org/linked_order",
  );
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
    // /on_init may omit fields present in /init (for example items[].category_id).
    // Keep callback values authoritative while retaining omitted INIT fields.
    const initialized = {
      ...initOrder,
      ...onInitOrder,
      provider: {
        ...initOrder.provider,
        ...onInitOrder?.provider,
        locations:
          onInitOrder?.provider?.locations ?? initOrder.provider.locations,
      },
      items: mergeById(initOrder.items, onInitOrder?.items, []),
      fulfillments: mergeById(
        initOrder.fulfillments,
        onInitOrder?.fulfillments,
        [],
      ),
    } as any;
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
    const orderId = suppliedOrder.id ?? state.orderId ?? randomUUID();
    const now = new Date().toISOString();
    const order: OndcConfirmOrder = {
      ...initialized,
      ...suppliedOrder,
      id: orderId,
      state: "Created",
      created_at: suppliedOrder.created_at ?? initialized.created_at ?? now,
      updated_at: now,
      provider: initialized.provider,
      // Items and fulfillments are generated from initialized DB state after consistency checks.
      items: initialized.items,
      fulfillments: initialized.fulfillments,
      quote: initialized.quote,
      billing: initialized.billing,
      payment: initialized.payment,
      "@ondc/org/linked_order": initialized["@ondc/org/linked_order"],
      tags: withBapAcceptance(suppliedOrder.tags ?? initialized.tags),
    } as OndcConfirmOrder;

    const payload: OndcConfirmRequest = {
      context: {
        ...state.init.context,
        action: "confirm",
        transaction_id: initTransactionId,
        message_id: (input.context?.message_id as string) ?? randomUUID(),
        timestamp: now,
      },
      message: { order },
    };
    validateConfirmPayload(payload);
    console.log(
      "[confirm.service] final ONDC /confirm payload",
      JSON.stringify(payload, null, 2),
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
