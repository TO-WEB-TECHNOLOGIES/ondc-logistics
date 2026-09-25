import type { OndcOnSearchResponse } from "../types/search/ondc.js";
import type { OnSearchRepository } from "../repositories/on-search.repository.js";
import { searchSseManager } from "../utils/streams/search-sse.js";
import { clientStreamManager } from "../utils/streams/client-stream.js";
import type { CallbackStream } from "../utils/streams/callback-stream.js";

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
        for (const provider of result.providers) {
          searchSseManager.publish(result.searchId, {
            event: "search_result",
            searchId: result.searchId,
            provider,
          });
          stream.push(response.context.transaction_id, "search_result", {
            searchId: result.searchId,
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
