/**
 * Drops undefined values and empty objects so app-facing events never carry
 * `null`/`{}` noise. Returns undefined when nothing is left.
 */
export const compact = <T extends Record<string, unknown>>(value: T) => {
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (v === undefined) continue;
    if (v && typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length)
      continue;
    out[key] = v;
  }
  return Object.keys(out).length ? (out as Partial<T>) : undefined;
};
