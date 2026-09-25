import type { Response } from "express";
import type { SearchSseEvent } from "../../types/search/internal.js";

interface Subscriber {
  response: Response;
  close: () => void;
}

export class SearchSseManager {
  private readonly subscribers = new Map<string, Set<Subscriber>>();

  subscribe(searchId: string, response: Response): () => void {
    console.log("[search.sse] subscriber connecting", { searchId });
    response.status(200);
    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders();
    response.write(": connected\n\n");

    const subscriber: Subscriber = {
      response,
      close: () => {
        this.subscribers.get(searchId)?.delete(subscriber);
        if (this.subscribers.get(searchId)?.size === 0)
          this.subscribers.delete(searchId);
      },
    };
    const searchSubscribers =
      this.subscribers.get(searchId) ?? new Set<Subscriber>();
    searchSubscribers.add(subscriber);
    this.subscribers.set(searchId, searchSubscribers);
    console.log("[search.sse] subscriber registered", {
      searchId,
      subscriberCount: searchSubscribers.size,
    });
    response.on("close", subscriber.close);
    return subscriber.close;
  }

  publish(searchId: string, event: SearchSseEvent): void {
    console.log("[search.sse] publishing event", {
      searchId,
      event: event.event,
      subscriberCount: this.subscribers.get(searchId)?.size ?? 0,
    });
    const encoded = `event: ${event.event}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const subscriber of this.subscribers.get(searchId) ?? []) {
      subscriber.response.write(encoded);
    }
  }

  complete(searchId: string, event: SearchSseEvent): void {
    console.log("[search.sse] completing stream", {
      searchId,
      reason: event.event,
    });
    this.publish(searchId, event);
    for (const subscriber of this.subscribers.get(searchId) ?? []) {
      subscriber.close();
      subscriber.response.end();
    }
    this.subscribers.delete(searchId);
  }
}

export const searchSseManager = new SearchSseManager();
