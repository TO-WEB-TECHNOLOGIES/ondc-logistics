import type { AnyOrder } from "../repositories/logistics-order-shared.js";
import { normalizeTags, tagListToRecord } from "../utils/ondc-tags.js";
import { compact } from "../utils/compact.js";

/**
 * Extra /on_track details for the order_tracking stream event (contract
 * footnotes 175–185): the tracked fulfillment, when the rider's position was
 * last updated, how tracking works (config: attr "tracking.location.gps" with
 * type "live_poll", or "tracking.url" with "deferred"), the tracked order id
 * and the raw tags. The existing url/status/gps/path fields stay as they are.
 */
export const buildTrackingDetails = (tracking: AnyOrder | undefined) => {
  if (!tracking) return {};
  const tags = normalizeTags(tracking.tags);
  return (
    compact({
      fulfillmentId: tracking.id as string | undefined,
      locationUpdatedAt: tracking.location?.updated_at as string | undefined,
      config: tagListToRecord(tags, "config"),
      trackedOrderId: tagListToRecord(tags, "order")?.id,
      tags: tags.length ? tags : undefined,
    }) ?? {}
  );
};
