import { toZonedTime, formatInTimeZone } from "date-fns-tz";

const TIMEZONE = "Asia/Kolkata";

/**
 * Returns the current Indian Standard Time (IST) as a JavaScript Date object.
 * Use this instead of `new Date()` everywhere to ensure consistent IST timestamps
 * across all database writes, ONDC context objects, and log entries.
 */
export function indianNow(): Date {
  return toZonedTime(new Date(), TIMEZONE);
}

/**
 * Returns the current IST as an ISO 8601 string (e.g. "2026-03-29T08:30:00.000+05:30").
 * Use this for ONDC context.timestamp and any string timestamp fields.
 */
export function indianNowISO(): string {
  return formatInTimeZone(new Date(), TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss.SSSxxx");
}

/**
 * Returns the current UTC time as an ISO 8601 string (e.g. "2026-03-29T08:30:00.000Z").
 * Use this for RSF context.timestamp and settlement.updated_at — RSF requires UTC.
 */
export function utcNowISO(): string {
  return new Date().toISOString();
}