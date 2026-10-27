import type { Request, Response, NextFunction } from "express";
import { ondcLog, type OndcAction } from "../utils/ondc-logger.js";
import {
  callbackIds,
  consoleLine,
  describeError,
  formatBytes,
  formatMs,
  paint,
} from "../utils/console-format.js";

/**
 * Console + file logging for every inbound ONDC callback (BPP → BAP).
 * Mounted first on each callback route so signature/context rejections are
 * logged too. Logs only the body and our sync response — never request
 * headers (Authorization / X-Gateway-Authorization carry signatures).
 *
 * CALLBACK_LOG = off | on | full (default full):
 *   on   — one ⇠ line on arrival, one ✓/✗ line with ACK/NACK, status, duration
 *   full — plus the full request body and our response body
 * File logs (logs/ondc/) get ondcLog.inbound / inboundAck regardless.
 */
type Level = "off" | "on" | "full";
const LEVEL: Level = (["off", "on", "full"] as const).includes(
  process.env.CALLBACK_LOG as Level,
)
  ? (process.env.CALLBACK_LOG as Level)
  : "full";

const pretty = (value: unknown) =>
  JSON.stringify(value, null, 2)
    .split("\n")
    .map((l) => `    ${l}`)
    .join("\n");

// Logging must never throw or change the ACK/NACK.
const safely = (fn: () => void) => {
  try {
    fn();
  } catch (error) {
    process.stderr.write(
      `[callback-log] logging failed: ${describeError(error)}\n`,
    );
  }
};

export const callbackLogMiddleware =
  (action: OndcAction) =>
  (request: Request, response: Response, next: NextFunction): void => {
    const started = Date.now();
    const body = request.body;
    const correlation = callbackIds(body);

    safely(() => {
      ondcLog.inbound(action, body);
      if (LEVEL === "off") return;
      const size = (request as any).rawBody?.length;
      console.log(
        consoleLine(
          paint("magenta", "⇠"),
          action,
          `received${size ? ` ${formatBytes(size)}` : ""}`,
          correlation,
        ),
      );
      if (LEVEL === "full")
        console.log(paint("gray", `  · request body\n${pretty(body)}`));
    });

    let responseBody: unknown;
    const originalJson = response.json.bind(response);
    response.json = (payload: unknown) => {
      responseBody = payload;
      return originalJson(payload);
    };

    response.on("finish", () =>
      safely(() => {
        const r = (responseBody ?? {}) as Record<string, any>;
        const ack = r.message?.ack?.status as "ACK" | "NACK" | undefined;
        const ok = ack === "ACK" && response.statusCode < 400;
        ondcLog.inboundAck(
          action,
          body,
          ack ?? (ok ? "ACK" : "NACK"),
          response.statusCode,
        );
        if (LEVEL === "off") return;
        const summary = `${ack ?? "no ack body"} ${response.statusCode} · ${formatMs(Date.now() - started)}`;
        console.log(
          consoleLine(
            ok ? paint("green", "✓") : paint("red", "✗"),
            action,
            ok ? paint("green", summary) : paint("red", summary),
            correlation,
          ),
        );
        if (!ok && r.error)
          for (const [key, value] of [
            ["type", r.error.type],
            ["code", r.error.code],
            ["path", r.error.path],
            ["message", r.error.message],
          ] as const)
            if (value !== undefined)
              console.log(`  ${paint("red", "│")} ${paint("gray", key.padEnd(8))} ${value}`);
        if (LEVEL === "full" && responseBody !== undefined)
          console.log(paint("gray", `  · response body\n${pretty(responseBody)}`));
      }),
    );

    next();
  };
