/**
 * Mapper for updateType "READY_TO_SHIP".
 *
 * Contract reference: docs/ondc/ondc logistics.docx, "/update" section —
 * "Notify LSP that retail order is ready to ship" is one of the documented
 * /update use cases, carried as a fulfillment tag:
 * order.fulfillments[].tags = [{code:"state", list:[{code:"ready_to_ship", value:"yes"}]}]
 *
 * The contract's /update sample is this ready-to-ship notification and carries
 * order["@ondc/org/linked_order"] alongside it, so the stored linked order is
 * echoed (with any caller-supplied overrides) whenever one exists.
 */
import type { OndcTag } from "../../types/search/ondc.js";
import type { ReadyToShipUpdateRequest } from "../../types/update/internal.js";
import type { OndcUpdateOrder } from "../../types/update/ondc.js";
import { buildLinkedOrder } from "./linked-order.mapper.js";
import { buildBaseOrder, mergeTagsByCode, type LogisticsOrderRow } from "./shared.js";

export const buildReadyToShipUpdate = (
  row: LogisticsOrderRow,
  input: ReadyToShipUpdateRequest,
  tags: OndcTag[],
): OndcUpdateOrder => {
  const merged = mergeTagsByCode(tags, [
    { code: "state", list: [{ code: "ready_to_ship", value: "yes" }] },
  ]);
  const linked = buildLinkedOrder(row, input.linkedOrder);
  return {
    ...buildBaseOrder(row, merged),
    ...(linked ? { "@ondc/org/linked_order": linked } : {}),
  };
};
