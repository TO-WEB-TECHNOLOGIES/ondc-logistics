import type { extractInitOrder } from "./init-persistence.mapper.js";
import { tagListToRecord } from "../utils/ondc-tags.js";

type ExtractedInitOrder = ReturnType<typeof extractInitOrder>;
type ExtractedSide = ExtractedInitOrder["fulfillments"][number]["start"];

/** Drops undefined values and empty objects so events never carry `null`/`{}` noise. */
const compact = <T extends Record<string, unknown>>(value: T) => {
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (v === undefined) continue;
    if (v && typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length)
      continue;
    out[key] = v;
  }
  return Object.keys(out).length ? (out as Partial<T>) : undefined;
};

const side = (s: ExtractedSide) =>
  compact({
    gps: s.gps,
    address: s.address ? compact(s.address) : undefined,
    contact: compact({ phone: s.contactPhone, email: s.contactEmail }),
    time: compact({
      duration: s.timeDuration,
      timestamp: s.timeTimestamp,
      range: compact({ start: s.timeRangeStart, end: s.timeRangeEnd }),
    }),
    instructions: compact({
      code: s.instructionCode,
      shortDesc: s.instructionShortDesc,
      longDesc: s.instructionLongDesc,
    }),
  });

/**
 * App-facing `init_result` stream event for a successful /on_init: the
 * quote plus who it's from (bppId/bppUri) and the terms accepted at /confirm
 * (order bpp_terms, cancellation terms). Tag groups are passed through raw;
 * bpp_terms is also flattened with the contract's codes as keys.
 */
export const buildInitResultEvent = (
  extracted: ExtractedInitOrder,
  context: { bpp_id?: string; bpp_uri?: string },
) => {
  const bppTerms = tagListToRecord(extracted.tags, "bpp_terms");
  const payment = compact({
    ...(extracted.payment ?? {}),
    // Present only when the LSP sends them (e.g. POST-FULFILLMENT).
    settlementDetails: extracted.settlements.length
      ? extracted.settlements
      : undefined,
  });
  return {
    ...(context.bpp_id ? { bppId: context.bpp_id } : {}),
    ...(context.bpp_uri ? { bppUri: context.bpp_uri } : {}),
    providerId: extracted.providerId,
    ...(extracted.providerLocationIds.length
      ? { providerLocationIds: extracted.providerLocationIds }
      : {}),
    items: extracted.items.map((item) => ({
      itemId: item.itemId,
      name: item.descriptorName,
      fulfillmentId: item.fulfillmentId,
      quantityCount: item.quantityCount,
      ...compact({
        categoryId: item.categoryId,
        descriptorCode: item.descriptorCode,
        time: compact({
          label: item.timeLabel,
          duration: item.timeDuration,
          timestamp: item.timeTimestamp,
        }),
      }),
    })),
    fulfillments: extracted.fulfillments.map((f) => {
      const riderCheck = tagListToRecord(f.tags, "rider_check")
        ?.inline_check_for_rider;
      return {
        fulfillmentId: f.fulfillmentId,
        type: f.type,
        ...compact({ start: side(f.start), end: side(f.end) }),
        ...(f.tags.length ? { tags: f.tags } : {}),
        ...(riderCheck ? { riderCheck } : {}),
      };
    }),
    quote: extracted.quote,
    quoteBreakups: extracted.quoteBreakups,
    cancellationTerms: extracted.cancellationTerms,
    ...(payment ? { payment } : {}),
    ...(bppTerms ? { bppTerms } : {}),
    ...(extracted.tags.length ? { tags: extracted.tags } : {}),
  };
};
