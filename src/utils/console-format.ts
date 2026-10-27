import { styleText } from "node:util";
import { indianNowISO } from "./indian-time.js";

/**
 * Console formatting helpers (logging-style skill, rule 1): colored only on a
 * TTY with NO_COLOR unset, one event per line —
 * `time icon label message ids`. Console only; file logs stay plain text.
 */
type Style = Parameters<typeof styleText>[0];

const useColor = !!process.stdout.isTTY && !process.env.NO_COLOR;

export const paint = (style: Style, text: string) =>
  useColor ? styleText(style, text) : text;

export const truncate = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}... (${text.length} chars)` : text;

export const formatBytes = (bytes: number) =>
  bytes < 1024 ? `${bytes}B` : `${(bytes / 1024).toFixed(1)}KB`;

export const formatMs = (ms: number) =>
  ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;

/** `HH:mm:ss.SSS` in IST, matching the file logs' clock. */
const clock = () => indianNowISO().slice(11, 23);

export const consoleLine = (
  icon: string,
  label: string,
  message: string,
  correlation = "",
) =>
  `${paint("gray", clock())} ${icon} ${paint("bold", label.padEnd(16))} ${message}${
    correlation ? `  ${paint("gray", correlation)}` : ""
  }`;

/**
 * Correlation ids for an ONDC callback body (rule 2): context ids plus the
 * order / issue / fulfillment id wherever the action carries it.
 */
export const callbackIds = (body: unknown): string => {
  if (!body || typeof body !== "object") return "";
  const b = body as Record<string, any>;
  const c = b.context ?? {};
  const m = b.message ?? {};
  const pairs: Array<[string, unknown]> = [
    ["action", c.action],
    ["transactionId", c.transaction_id],
    ["messageId", c.message_id],
    ["bppId", c.bpp_id],
    ["orderId", m.order?.id ?? m.order_id],
    ["issueId", m.issue?.id ?? m.issue_id],
    ["fulfillmentId", m.tracking?.id],
  ];
  return pairs
    .filter(([, v]) => v !== undefined && v !== null && typeof v !== "object")
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
};

/** `msg (cause: …)` without a stack (rule 3). */
export const describeError = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as Error & { cause?: unknown }).cause;
  return cause ? `${error.message} (cause: ${describeError(cause)})` : error.message;
};
