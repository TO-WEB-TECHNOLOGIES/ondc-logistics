export type OndcNetworkError = { type?: string; code: string; message: string };

/** Network-facing ONDC errors are deliberately whitelisted. Diagnostic fields stay in logs. */
export const ondcError = (input: OndcNetworkError) => ({
  ...(input.type ? { type: input.type } : {}),
  code: input.code,
  message: input.message,
});

export const ondcNack = (error: OndcNetworkError) => ({
  message: { ack: { status: "NACK" as const } },
  error: ondcError(error),
});
