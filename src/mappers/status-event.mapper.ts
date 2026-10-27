import type { AnyOrder } from "../repositories/logistics-order-shared.js";
import { normalizeTags, tagListToRecord } from "../utils/ondc-tags.js";
import { compact } from "../utils/compact.js";

const side = (s: AnyOrder | undefined) =>
  compact({
    time: compact({
      duration: s?.time?.duration,
      timestamp: s?.time?.timestamp,
      range: compact({ start: s?.time?.range?.start, end: s?.time?.range?.end }),
    }),
    instructions: compact({
      // Proof of pickup/delivery, shipping label, etc. (contract: optional).
      images: Array.isArray(s?.instructions?.images) && s.instructions.images.length
        ? (s.instructions.images as string[])
        : undefined,
    }),
  });

/**
 * Per-fulfillment details from an /on_status order for the app-facing
 * `order_status` event: state, rider (agent) and vehicle, tracking
 * attributes, pickup/delivery times, delay audit trail and proof images.
 * Read straight from the callback — none of this is persisted yet.
 * Tag groups keep the contract's codes as keys; raw tags are passed through.
 */
export const buildStatusFulfillments = (order: AnyOrder) =>
  (Array.isArray(order?.fulfillments) ? order.fulfillments : []).map(
    (f: AnyOrder) => {
      const tags = normalizeTags(f.tags);
      return {
        fulfillmentId: f.id as string,
        ...compact({
          type: f.type as string | undefined,
          state: compact({
            code: f.state?.descriptor?.code as string | undefined,
            shortDesc: f.state?.descriptor?.short_desc as string | undefined,
          }),
          agent: compact({
            name: f.agent?.name as string | undefined,
            phone: f.agent?.phone as string | undefined,
          }),
          vehicle: compact({
            registration: f.vehicle?.registration as string | undefined,
          }),
          tracking: typeof f.tracking === "boolean" ? f.tracking : undefined,
          trackingInfo: tagListToRecord(tags, "tracking"),
          delay: tagListToRecord(tags, "fulfillment_delay"),
          start: side(f.start),
          end: side(f.end),
          tags: tags.length ? tags : undefined,
        }),
      };
    },
  );
