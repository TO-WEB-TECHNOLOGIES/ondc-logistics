import type { NormalizedProviderResult } from "../types/search/internal.js";
import type {
  OndcOnSearchResponse,
  OndcProvider,
} from "../types/search/ondc.js";

const distanceTag = (provider: OndcProvider, fulfillmentId: string) => {
  const fulfillment = provider.fulfillments?.find(
    (item) => item.id === fulfillmentId,
  );
  const distance = fulfillment?.tags?.find((tag) => tag.code === "distance");
  return {
    type: distance?.list?.find(
      (item) => item.code === "motorable_distance_type",
    )?.value,
    value: distance?.list?.find((item) => item.code === "motorable_distance")
      ?.value,
  };
};

export const mapOnSearchToProviderResults = (
  response: OndcOnSearchResponse,
): NormalizedProviderResult[] =>
  response.message.catalog["bpp/providers"].map((provider) => ({
    providerId: provider.id,
    name: provider.descriptor?.name,
    shortDescription: provider.descriptor?.short_desc,
    longDescription: provider.descriptor?.long_desc,
    categories: (provider.categories ?? []).map((category) => ({
      categoryId: category.id,
      timeLabel: category.time?.label,
      duration: category.time?.duration,
      timestamp: category.time?.timestamp,
    })),
    fulfillments: (provider.fulfillments ?? []).map((fulfillment) => {
      const distance = distanceTag(provider, fulfillment.id);
      return {
        fulfillmentId: fulfillment.id,
        type: fulfillment.type,
        pickupDuration: fulfillment.start?.time?.duration,
        motorableDistance: distance.value,
        motorableDistanceUnit: distance.type,
      };
    }),
    locations: (provider.locations ?? []).map((location) => ({
      locationId: location.id,
      gps: location.gps,
      street: location.address?.street,
      city: location.address?.city,
      state: location.address?.state,
      areaCode: location.address?.area_code,
    })),
    items: (provider.items ?? []).map((item) => ({
      catalogItemId: item.id,
      parentItemId: item.parent_item_id || undefined,
      categoryId: item.category_id,
      fulfillmentId: item.fulfillment_id,
      descriptorCode: item.descriptor?.code,
      name: item.descriptor?.name,
      shortDescription: item.descriptor?.short_desc,
      longDescription: item.descriptor?.long_desc,
      tatLabel: item.time?.label,
      tatDuration: item.time?.duration,
      tatTimestamp: item.time?.timestamp,
      priceAmount: item.price?.value,
      priceCurrency: item.price?.currency,
    })),
  }));
