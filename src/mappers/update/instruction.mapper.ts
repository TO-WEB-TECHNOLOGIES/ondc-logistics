/**
 * Mapper for updateType "START_INSTRUCTION" / "END_INSTRUCTION" (PCC/DCC).
 *
 * Contract reference: docs/ondc/ondc logistics.docx, "/update" section —
 * "Provide updated delivery instructions to LSP" is one of the documented
 * /update use cases, carried in order.fulfillments[].start|end.instructions.
 */
import type { OndcTag } from "../../types/search/ondc.js";
import type { InstructionUpdateRequest } from "../../types/update/internal.js";
import type { OndcUpdateOrder } from "../../types/update/ondc.js";
import { buildBaseOrder, type LogisticsOrderRow } from "./shared.js";

export const buildInstructionUpdate = (
  row: LogisticsOrderRow,
  input: InstructionUpdateRequest,
  tags: OndcTag[],
): OndcUpdateOrder => {
  const side = input.updateType === "START_INSTRUCTION" ? "start" : "end";
  // Falls back to the previously stored short_desc for this side when the
  // caller omits it — start_instructions_short_desc_present (see shared.ts)
  // requires a non-empty start short_desc whenever state=ready_to_ship="yes"
  // is also on the payload, so a caller updating only, say, the code
  // shouldn't accidentally drop it.
  const storedShortDesc =
    side === "start" ? row.startInstructionShortDesc : row.endInstructionShortDesc;
  const shortDesc = input.instruction.shortDesc ?? storedShortDesc ?? undefined;
  const instructions = {
    code: input.instruction.code,
    ...(shortDesc ? { short_desc: shortDesc } : {}),
    ...(input.instruction.longDesc
      ? { long_desc: input.instruction.longDesc }
      : {}),
    ...(input.instruction.images?.length
      ? { images: input.instruction.images }
      : {}),
  };

  const base = buildBaseOrder(row, tags);
  const fulfillment = base.fulfillments[0] as any;
  return {
    ...base,
    fulfillments: [
      { ...fulfillment, [side]: { ...fulfillment[side], instructions } },
    ],
  };
};
