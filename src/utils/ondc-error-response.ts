export type OndcNetworkError = { type?: string; code: string; message: string };

/** Network-facing ONDC errors are deliberately whitelisted. Diagnostic fields stay in logs. */
export const ondcError = (input: OndcNetworkError) => ({
  ...(input.type ? { type: input.type } : {}),
  code: input.code,
  message: input.message,
});

/**
 * Echoes the callback's `context` on a sync ACK/NACK body, following the
 * contract's /on_search ACK response sample. Empty when the body has no
 * usable context (e.g. a malformed callback).
 */
export const syncResponseContext = (body: unknown) => {
  const context = (body as { context?: unknown } | undefined)?.context;
  return context && typeof context === "object" && !Array.isArray(context)
    ? { context }
    : {};
};

export const ondcNack = (error: OndcNetworkError) => ({
  message: { ack: { status: "NACK" as const } },
  error: ondcError(error),
});

/** Sync ACK for a callback: echoed context + message.ack. */
export const ondcAck = (body: unknown) => ({
  ...syncResponseContext(body),
  message: { ack: { status: "ACK" as const } },
});

/**
 * Sync NACK for an internal processing failure on a callback. The contract
 * ("Rules for order confirmation") specifies http 503/504 with retriable
 * error code 63001 for LBNP internal errors, so the sender retries.
 */
export const ONDC_INTERNAL_ERROR_HTTP_STATUS = 503;
export const ondcInternalErrorNack = (body: unknown) => ({
  ...syncResponseContext(body),
  ...ondcNack({
    type: "CORE-ERROR",
    code: "63001",
    message: "Internal error while processing callback; retry",
  }),
});
