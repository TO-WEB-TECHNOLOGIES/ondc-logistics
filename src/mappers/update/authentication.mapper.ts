/**
 * Mapper for updateType "START_AUTHENTICATION" / "END_AUTHENTICATION" (OTP).
 *
 * Contract reference: docs/ondc/ondc logistics.docx, "/update" section —
 * "Update authorization details for pickup / delivery" is one of the
 * documented /update use cases, carried in
 * order.fulfillments[].start|end.authorization = {type, token, valid_from,
 * valid_to}.
 */
import type { OndcTag } from "../../types/search/ondc.js";
import type { AuthenticationUpdateRequest } from "../../types/update/internal.js";
import type { OndcUpdateOrder } from "../../types/update/ondc.js";
import { buildBaseOrder, type LogisticsOrderRow } from "./shared.js";

/** Falls back to a 10-minute validity window when the caller omits it. */
const DEFAULT_VALIDITY_MS = 10 * 60 * 1000;

export const buildAuthenticationUpdate = (
  row: LogisticsOrderRow,
  input: AuthenticationUpdateRequest,
  tags: OndcTag[],
): OndcUpdateOrder => {
  const side = input.updateType === "START_AUTHENTICATION" ? "start" : "end";
  const now = new Date();
  const authorization = {
    type: input.authorization.type ?? "OTP",
    token: input.authorization.token,
    valid_from: input.authorization.validFrom ?? now.toISOString(),
    valid_to:
      input.authorization.validTo ??
      new Date(now.getTime() + DEFAULT_VALIDITY_MS).toISOString(),
  };

  const base = buildBaseOrder(row, tags);
  const fulfillment = base.fulfillments[0] as any;
  return {
    ...base,
    fulfillments: [
      { ...fulfillment, [side]: { ...fulfillment[side], authorization } },
    ],
  };
};
