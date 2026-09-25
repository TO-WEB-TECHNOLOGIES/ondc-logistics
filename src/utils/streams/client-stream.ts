import type { Response } from "express";

/**
 * Single unified SSE channel, keyed by a frontend-generated clientId and
 * bound to whichever transaction_id it's watching. In-memory, single-process
 * only — same limitation as search-sse.ts/order-sse.ts (no cross-instance
 * fan-out, nothing replayed on reconnect/restart).
 *
 * Binding is last-write-wins per transactionId: opening a second stream for
 * the same transaction takes over delivery from the first.
 */

interface Subscriber {
  response: Response;
  heartbeat: NodeJS.Timeout;
}

const HEARTBEAT_INTERVAL_MS = 25_000;

export type ClientStreamPushResult = "delivered" | "no_client_found";

export class ClientStreamManager {
  private readonly clients = new Map<string, Subscriber>();
  private readonly transactionToClient = new Map<string, string>();

  subscribe(clientId: string, response: Response): () => void {
    console.log("[client-stream] subscriber connecting", { clientId });
    response.status(200);
    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders();
    response.write(": connected\n\n");

    const heartbeat = setInterval(() => {
      response.write(": heartbeat\n\n");
    }, HEARTBEAT_INTERVAL_MS);

    const close = () => {
      clearInterval(heartbeat);
      if (this.clients.get(clientId)?.response === response) {
        this.clients.delete(clientId);
      }
    };

    this.clients.set(clientId, { response, heartbeat });
    console.log("[client-stream] subscriber registered", {
      clientId,
      clientCount: this.clients.size,
    });
    response.on("close", close);
    return close;
  }

  /** Binds transactionId to clientId. Call once the transaction_id is known (e.g. right after minting it for /search). */
  bind(transactionId: string, clientId: string): void {
    console.log("[client-stream] binding transaction to client", {
      transactionId,
      clientId,
    });
    this.transactionToClient.set(transactionId, clientId);
  }

  push(
    transactionId: string,
    event: string,
    data: Record<string, unknown>,
  ): ClientStreamPushResult {
    const clientId = this.transactionToClient.get(transactionId);
    const subscriber = clientId ? this.clients.get(clientId) : undefined;
    console.log("[client-stream] pushing event", {
      transactionId,
      event,
      clientId,
      delivered: Boolean(subscriber),
    });
    if (!subscriber) return "no_client_found";

    const payload = { event, transactionId, ...data };
    subscriber.response.write(
      `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`,
    );
    return "delivered";
  }
}

export const clientStreamManager = new ClientStreamManager();
