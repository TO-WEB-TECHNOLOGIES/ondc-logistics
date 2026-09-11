/**
 * Mapper for updateType "LINKED_ORDER_DETAILS".
 *
 * Contract reference: docs/ondc/ondc logistics.docx, "/update" section —
 * "Update linked order details in case of part return / cancel for retail
 * order" is one of the documented /update use cases, carried in
 * order["@ondc/org/linked_order"].
 */
import type { OndcTag } from "../../types/search/ondc.js";
import type { LinkedOrderDetailsUpdateRequest } from "../../types/update/internal.js";
import type { OndcUpdateOrder } from "../../types/update/ondc.js";
import { buildBaseOrder, type LogisticsOrderRow } from "./shared.js";

export const buildLinkedOrderDetailsUpdate = (
  row: LogisticsOrderRow,
  input: LinkedOrderDetailsUpdateRequest,
  tags: OndcTag[],
): OndcUpdateOrder => {
  const { linkedOrder } = input;
  // Minimal input: only fields the caller actually supplies are changed;
  // anything omitted falls back to what's already stored for this order.
  const retailOrderId = linkedOrder.retailOrderId ?? row.linkedOrderRetailOrderId ?? undefined;
  const productName = linkedOrder.productName ?? row.linkedOrderProductName ?? undefined;
  const quantityCount = linkedOrder.quantityCount ?? row.linkedOrderQuantityCount ?? undefined;
  const weightUnit = linkedOrder.weight?.unit ?? row.linkedOrderWeightUnit ?? undefined;
  const weightValue = linkedOrder.weight?.value ?? row.linkedOrderWeightValue ?? undefined;
  const lengthUnit = linkedOrder.dimensions?.length?.unit ?? row.linkedOrderLengthUnit ?? undefined;
  const lengthValue = linkedOrder.dimensions?.length?.value ?? row.linkedOrderLengthValue ?? undefined;
  const breadthUnit = linkedOrder.dimensions?.breadth?.unit ?? row.linkedOrderBreadthUnit ?? undefined;
  const breadthValue = linkedOrder.dimensions?.breadth?.value ?? row.linkedOrderBreadthValue ?? undefined;
  const heightUnit = linkedOrder.dimensions?.height?.unit ?? row.linkedOrderHeightUnit ?? undefined;
  const heightValue = linkedOrder.dimensions?.height?.value ?? row.linkedOrderHeightValue ?? undefined;
  const providerName = linkedOrder.providerName ?? row.linkedOrderProviderName ?? undefined;

  return {
    ...buildBaseOrder(row, tags),
    "@ondc/org/linked_order": {
      ...(productName || quantityCount !== undefined
        ? {
            items: [
              {
                descriptor: { name: productName },
                quantity: { count: quantityCount },
              },
            ],
          }
        : {}),
      ...(providerName
        ? { provider: { descriptor: { name: providerName } } }
        : {}),
      order: {
        id: retailOrderId,
        weight: { unit: weightUnit, value: weightValue },
        dimensions: {
          length: { unit: lengthUnit, value: lengthValue },
          breadth: { unit: breadthUnit, value: breadthValue },
          height: { unit: heightUnit, value: heightValue },
        },
      },
    },
  };
};
