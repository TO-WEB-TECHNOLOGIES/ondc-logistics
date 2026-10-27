import type { OndcOnSearchResponse } from "../types/search/ondc.js";
import type { OnSearchRepository } from "../repositories/on-search.repository.js";
import { searchSseManager } from "../utils/streams/search-sse.js";
import { clientStreamManager } from "../utils/streams/client-stream.js";
import type { CallbackStream } from "../utils/streams/callback-stream.js";
import type { SearchResultBpp } from "../types/search/internal.js";
import { normalizeTags, tagListToRecord } from "../utils/ondc-tags.js";

export interface OnSearchQueue {
  enqueue(
    callbackId: string,
    response: OndcOnSearchResponse,
    stream?: CallbackStream,
  ): Promise<void>;
}

export class InProcessOnSearchQueue implements OnSearchQueue {
  constructor(private readonly repository: OnSearchRepository) {}

  async enqueue(
    callbackId: string,
    response: OndcOnSearchResponse,
    stream: CallbackStream = clientStreamManager,
  ): Promise<void> {
    console.log("[on-search.queue] callback queued", {
      callbackId,
      transactionId: response.context.transaction_id,
    });

    setImmediate(async () => {
      try {
        console.log("[on-search.queue] processing callback", { callbackId });
        const result = await this.repository.process(callbackId, response);
        console.log("[on-search.queue] callback processed", {
          searchId: result.searchId,
          providerCount: result.providers.length,
        });
        // Provider/item/fulfillment ids are only unique within one LSP's
        // catalog; bppId (signature-verified context.bpp_id, the value /init
        // filters on) tells same-id options from different LSPs apart.
        // Same fallback as DrizzleOnSearchRepository.stage so the event value
        // always equals the stored one (bpp_id is required upstream anyway).
        const descriptor = response.message.catalog["bpp/descriptor"];
        const bppTerms = tagListToRecord(descriptor?.tags, "bpp_terms");
        const bpp: SearchResultBpp = {
          ...(descriptor?.name ? { name: descriptor.name } : {}),
          ...(bppTerms ? { terms: bppTerms } : {}),
          ...(descriptor?.tags?.length
            ? { tags: normalizeTags(descriptor.tags) }
            : {}),
        };
        const origin = {
          bppId: response.context.bpp_id ?? "unknown",
          ...(response.context.bpp_uri
            ? { bppUri: response.context.bpp_uri }
            : {}),
          ...(Object.keys(bpp).length ? { bpp } : {}),
        };
        for (const provider of result.providers) {
          searchSseManager.publish(result.searchId, {
            event: "search_result",
            searchId: result.searchId,
            ...origin,
            provider,
          });
          stream.push(response.context.transaction_id, "search_result", {
            searchId: result.searchId,
            ...origin,
            provider,
          });
        }
      } catch (error) {
        console.error("[on-search.queue] processing failed", error);
      }
    });
  }
}

export class OnSearchService {
  constructor(
    private readonly repository: OnSearchRepository,
    private readonly queue: OnSearchQueue = new InProcessOnSearchQueue(
      repository,
    ),
  ) {}

  async handleCallback(
    response: OndcOnSearchResponse,
    stream?: CallbackStream,
  ): Promise<void> {
    console.log("[on-search.service] callback received", {
      transactionId: response.context.transaction_id,
      messageId: response.context.message_id,
      bppId: response.context.bpp_id,
    });

    const staged = await this.repository.stage(response);
    console.log("[on-search.service] callback staged", staged);

    if (!staged.callbackId) throw new Error("search transaction not found");
    if (!staged.duplicate)
      await this.queue.enqueue(staged.callbackId, response, stream);
  }
}
