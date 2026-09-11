import type { logisticsOrder } from "../../db/schema/index.js";
import type { OndcTag } from "../../types/search/ondc.js";
import type { OndcUpdateOrder } from "../../types/update/ondc.js";

export type LogisticsOrderRow = typeof logisticsOrder.$inferSelect;

/**
 * ONDC workbench's validate_tag_0 rule: only these fulfillment tag codes are
 * accepted on /update — anything else (e.g. a stray "rto_action" code that
 * came from a caller-supplied /confirm request) must be dropped before
 * echoing stored tags back on the wire.
 */
const ALLOWED_FULFILLMENT_TAG_CODES = new Set([
  "state",
  "rider_details",
  "linked_provider",
  "linked_order",
  "linked_order_item",
  "fulfill_request",
  "rto_verification",
  "fulfill_response",
  "special_req",
  "linked_package",
]);

const isReadyToShipYes = (tags: OndcTag[]) =>
  tags.some(
    (t) =>
      t.code === "state" &&
      t.list?.some((l) => l.code === "ready_to_ship" && l.value === "yes"),
  );

/**
 * Base order.id/items/fulfillment identity every /update payload needs,
 * regardless of which field is actually being changed — per the contract's
 * /update example (docs/ondc/ondc logistics.docx), items[] and the touched
 * fulfillment's id/type are echoed even when only one sub-field changes.
 *
 * `tags` (the fulfillment's currently stored tags, e.g. state/ready_to_ship)
 * are echoed on every /update payload too, not just when a specific update
 * type sets them — omitting them once /confirm has set state=ready_to_ship
 * was observed to trip the ONDC workbench's
 * VALIDATE_TAG_STATE_VALUES_FOR_IMMEDIATE_DELIVERY check on later /update
 * calls for an Immediate Delivery order. Only ALLOWED_FULFILLMENT_TAG_CODES
 * are echoed (workbench's validate_tag_0).
 *
 * Whenever the (filtered) tags carry state=ready_to_ship="yes", the
 * workbench separately requires start.instructions.short_desc to be present
 * on the SAME payload (start_instructions_short_desc_present) — so it's
 * pulled from stored data here, satisfying that rule even for update types
 * that don't otherwise touch instructions. instruction.mapper.ts's
 * START_INSTRUCTION path overrides this with the caller's fresh value.
 */
export const buildBaseOrder = (
  row: LogisticsOrderRow,
  tags: OndcTag[] = [],
): OndcUpdateOrder => {
  const filteredTags = tags.filter((t) => ALLOWED_FULFILLMENT_TAG_CODES.has(t.code));
  const readyToShip = isReadyToShipYes(filteredTags);

  return {
    id: row.orderId,
    items: row.itemId
      ? [
          {
            id: row.itemId,
            ...(row.itemCategoryId ? { category_id: row.itemCategoryId } : {}),
            ...(row.itemDescriptorCode
              ? { descriptor: { code: row.itemDescriptorCode } }
              : {}),
          },
        ]
      : [],
    fulfillments: row.fulfillmentId
      ? [
          {
            id: row.fulfillmentId,
            ...(row.fulfillmentType ? { type: row.fulfillmentType } : {}),
            ...(filteredTags.length ? { tags: filteredTags } : {}),
            ...(readyToShip && row.startInstructionShortDesc
              ? {
                  start: {
                    instructions: {
                      ...(row.startInstructionCode
                        ? { code: row.startInstructionCode }
                        : {}),
                      short_desc: row.startInstructionShortDesc,
                    },
                  },
                }
              : {}),
          },
        ]
      : [],
  };
};

/**
 * Merges `base` (currently stored) tags with `overlay` (this update's new
 * tags) by `code` — overlay replaces a same-code entry, otherwise is added.
 * Used by ready-to-ship.mapper.ts so setting state=ready_to_ship doesn't
 * wipe out other stored tags.
 */
export const mergeTagsByCode = (base: OndcTag[], overlay: OndcTag[]): OndcTag[] => {
  const byCode = new Map<string, OndcTag>();
  for (const tag of base) byCode.set(tag.code, tag);
  for (const tag of overlay) byCode.set(tag.code, tag);
  return Array.from(byCode.values());
};
