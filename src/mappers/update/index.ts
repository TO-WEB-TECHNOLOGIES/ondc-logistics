/**
 * Dispatch + envelope builder for /update.
 *
 * Contract reference: docs/ondc/ondc logistics.docx, "/update" section.
 * `message.update_target` is hardcoded to "fulfillment" — it's the only
 * value the contract ever uses (no enum of values is defined there); the
 * per-field distinction lives entirely in our own UpdateType, which is
 * never sent to ONDC.
 */
import type { OndcContext, OndcTag } from "../../types/search/ondc.js";
import type { UpdateRequest, UpdateType } from "../../types/update/internal.js";
import type { OndcUpdateOrder, OndcUpdateRequest } from "../../types/update/ondc.js";
import { buildAuthenticationUpdate } from "./authentication.mapper.js";
import { buildInstructionUpdate } from "./instruction.mapper.js";
import { buildLinkedOrderDetailsUpdate } from "./linked-order.mapper.js";
import { buildReadyToShipUpdate } from "./ready-to-ship.mapper.js";
import type { LogisticsOrderRow } from "./shared.js";

type Builder = (
  row: LogisticsOrderRow,
  input: UpdateRequest,
  tags: OndcTag[],
) => OndcUpdateOrder;

const BUILDERS: Record<UpdateType, Builder> = {
  LINKED_ORDER_DETAILS: buildLinkedOrderDetailsUpdate as Builder,
  START_INSTRUCTION: buildInstructionUpdate as Builder,
  END_INSTRUCTION: buildInstructionUpdate as Builder,
  START_AUTHENTICATION: buildAuthenticationUpdate as Builder,
  END_AUTHENTICATION: buildAuthenticationUpdate as Builder,
  READY_TO_SHIP: buildReadyToShipUpdate as Builder,
};

export const buildUpdateOrder = (
  row: LogisticsOrderRow,
  input: UpdateRequest,
  tags: OndcTag[],
): OndcUpdateOrder => BUILDERS[input.updateType](row, input, tags);

export interface BuildUpdatePayloadInput {
  order: OndcUpdateOrder;
  context: Pick<
    OndcContext,
    "domain" | "country" | "city" | "core_version" | "bap_id" | "bap_uri"
  >;
  bppId: string;
  bppUri: string;
  transactionId: string;
  messageId: string;
  now: string;
}

export const buildUpdatePayload = ({
  order,
  context,
  bppId,
  bppUri,
  transactionId,
  messageId,
  now,
}: BuildUpdatePayloadInput): OndcUpdateRequest => ({
  context: {
    ...context,
    action: "update",
    bpp_id: bppId,
    bpp_uri: bppUri,
    transaction_id: transactionId,
    message_id: messageId,
    timestamp: now,
    ttl: "PT30S",
  },
  message: {
    update_target: "fulfillment",
    order: { ...order, updated_at: now },
  },
});
