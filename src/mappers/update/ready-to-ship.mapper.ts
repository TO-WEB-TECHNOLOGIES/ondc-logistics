/**
 * Mapper for updateType "READY_TO_SHIP".
 *
 * Contract reference: docs/ondc/ondc logistics.docx, "/update" section —
 * "Notify LSP that retail order is ready to ship" is one of the documented
 * /update use cases, carried as a fulfillment tag:
 * order.fulfillments[].tags = [{code:"state", list:[{code:"ready_to_ship", value:"yes"}]}]
 */
import type { OndcTag } from "../../types/search/ondc.js";
import type { ReadyToShipUpdateRequest } from "../../types/update/internal.js";
import type { OndcUpdateOrder } from "../../types/update/ondc.js";
import { buildBaseOrder, mergeTagsByCode, type LogisticsOrderRow } from "./shared.js";

export const buildReadyToShipUpdate = (
  row: LogisticsOrderRow,
  _input: ReadyToShipUpdateRequest,
  tags: OndcTag[],
): OndcUpdateOrder => {
  const merged = mergeTagsByCode(tags, [
    { code: "state", list: [{ code: "ready_to_ship", value: "yes" }] },
  ]);
  return buildBaseOrder(row, merged);
};
