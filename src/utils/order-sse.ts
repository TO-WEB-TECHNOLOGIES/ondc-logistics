import type { Response } from "express";

/**
 * Structural copy of SearchSseManager (search-sse.ts), keyed by orderId
 * instead of searchId. Same in-memory, single-process limitation applies —
 * see the /status implementation plan for why that isn't solved here.
 */
export interface OrderStatusSseEvent {
  event: "order_status";
  orderId: string;
  state?: string;
  fulfillmentState?: string;
  awbNo?: string;
  updatedAt: string;
}

/**
 * Published on /on_track. Same channel/subscription as order_status (one
 * SSE connection per order carries both event types, distinguished by
 * `event`) — reusing the existing GET .../status/events stream rather than
 * standing up a second endpoint. `path` carries the raw breadcrumb tag list
 * from the callback as-is (not persisted to the DB — see logistics-order.schema.ts).
 */
export interface OrderTrackingSseEvent {
  event: "order_tracking";
  orderId: string;
  url?: string;
  status?: string;
  gps?: string;
  locationTimestamp?: string;
  path?: Array<{ lat_lng?: string; sequence?: string }>;
  updatedAt: string;
}

export type OrderSseEvent = OrderStatusSseEvent | OrderTrackingSseEvent;

interface Subscriber {
  response: Response;
  close: () => void;
}

export class OrderSseManager {
  private readonly subscribers = new Map<string, Set<Subscriber>>();

  subscribe(orderId: string, response: Response): () => void {
    console.log("[order.sse] subscriber connecting", { orderId });
    response.status(200);
    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders();
    response.write(": connected\n\n");

    const subscriber: Subscriber = {
      response,
      close: () => {
        this.subscribers.get(orderId)?.delete(subscriber);
        if (this.subscribers.get(orderId)?.size === 0)
          this.subscribers.delete(orderId);
      },
    };
    const orderSubscribers = this.subscribers.get(orderId) ?? new Set<Subscriber>();
    orderSubscribers.add(subscriber);
    this.subscribers.set(orderId, orderSubscribers);
    console.log("[order.sse] subscriber registered", {
      orderId,
      subscriberCount: orderSubscribers.size,
    });
    response.on("close", subscriber.close);
    return subscriber.close;
  }

  publish(orderId: string, event: OrderSseEvent): void {
    console.log("[order.sse] publishing event", {
      orderId,
      event: event.event,
      subscriberCount: this.subscribers.get(orderId)?.size ?? 0,
    });
    const encoded = `event: ${event.event}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const subscriber of this.subscribers.get(orderId) ?? []) {
      subscriber.response.write(encoded);
    }
  }
}

export const orderSseManager = new OrderSseManager();
