import type { Response } from "express";
import { clientStreamManager } from "./client-stream.js";

/**
 * Per-callback wrapper around the unified client stream that holds events
 * back until the controller's sync ACK has been written to the network
 * participant (workbench/LSP). Without it, a repository pushes e.g.
 * "init_result" while the ACK for /on_init is still unsent, and a client
 * reacting to the event can fire the next request before the sender has
 * our ACK.
 *
 * One instance per incoming callback request:
 *   const stream = createCallbackStream();
 *   await service.handleCallback(callback, stream);   // repositories call stream.push(...)
 *   stream.releaseAfterAck(response);                  // then write the ACK
 *   response.status(200).json(ondcAck(request.body));
 * On a NACK / internal-error response call stream.discard() instead.
 *
 * Pushes made after release (e.g. the async /on_search queue) are delivered
 * immediately. Same in-memory, single-process limitation as client-stream.ts.
 */

export interface CallbackStream {
  push(
    transactionId: string,
    event: string,
    data: Record<string, unknown>,
  ): void;
}

interface QueuedEvent {
  transactionId: string;
  event: string;
  data: Record<string, unknown>;
}

type State = "pending" | "released" | "discarded";

export class DeferredCallbackStream implements CallbackStream {
  private state: State = "pending";
  private queue: QueuedEvent[] = [];

  constructor(private readonly target: CallbackStream) {}

  push(
    transactionId: string,
    event: string,
    data: Record<string, unknown>,
  ): void {
    if (this.state === "released") {
      this.target.push(transactionId, event, data);
      return;
    }
    if (this.state === "discarded") {
      console.log("[callback-stream] dropping event, callback was not acknowledged", {
        transactionId,
        event,
      });
      return;
    }
    this.queue.push({ transactionId, event, data });
  }

  /**
   * Flushes queued events once `response` has finished writing (the ACK was
   * handed to the socket). If the connection closes before that, the events
   * are discarded — the sender will retry the callback.
   */
  releaseAfterAck(response: Response): void {
    if (this.state !== "pending") return;
    response.once("finish", () => this.release());
    response.once("close", () => {
      if (!response.writableFinished) this.discard();
    });
  }

  discard(): void {
    if (this.state !== "pending") return;
    this.state = "discarded";
    if (this.queue.length) {
      console.log("[callback-stream] discarding queued events", {
        events: this.queue.map((e) => e.event),
      });
    }
    this.queue = [];
  }

  private release(): void {
    if (this.state !== "pending") return;
    this.state = "released";
    const queued = this.queue;
    this.queue = [];
    for (const { transactionId, event, data } of queued) {
      this.target.push(transactionId, event, data);
    }
  }
}

export const createCallbackStream = (
  target: CallbackStream = clientStreamManager,
): DeferredCallbackStream => new DeferredCallbackStream(target);
