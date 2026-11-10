/**
 * Environment-scoped env-var resolution.
 *
 * ENV (PROD | PREPROD, default PREPROD) selects which network environment this
 * process runs against. `envFor("X")` returns `${ENV}_X` (e.g. PREPROD_X) when
 * it is set and non-blank, otherwise the plain `X`. Only network-identity /
 * per-environment values go through here (keys, subscriber ids, URLs, DB URLs,
 * tokens); process/runtime knobs keep reading process.env directly.
 */
import "dotenv/config";

export type OndcEnv = "PROD" | "PREPROD";

function resolveEnv(): OndcEnv {
  const raw = (process.env.ENV ?? "").trim().toUpperCase();
  if (raw === "PROD" || raw === "PREPROD") return raw;
  if (raw !== "") {
    console.warn(`[env] Unknown ENV="${process.env.ENV}" — falling back to PREPROD.`);
  }
  return "PREPROD";
}

export const ENV: OndcEnv = resolveEnv();

/** Which variable each envFor() lookup resolved from (names only, never values). */
const resolvedSources = new Map<string, string>();

const nonBlank = (value: string | undefined): string | undefined =>
  value !== undefined && value.trim() !== "" ? value : undefined;

/**
 * First non-blank value across `names`, checking every `${ENV}_<name>` before any
 * plain `<name>` — e.g. envForFirst("PSQL_URI", "DATABASE_URL") →
 * PREPROD_PSQL_URI, PREPROD_DATABASE_URL, PSQL_URI, DATABASE_URL.
 */
export function envForFirst(...names: string[]): string | undefined {
  const candidates = [...names.map((n) => `${ENV}_${n}`), ...names];
  const key = names.join("|");
  for (const candidate of candidates) {
    const value = nonBlank(process.env[candidate]);
    if (value !== undefined) {
      resolvedSources.set(key, candidate);
      return value;
    }
  }
  resolvedSources.set(key, "(unset)");
  return undefined;
}

/** `${ENV}_${name}` when set and non-blank, else plain `name` (may be undefined). */
export function envFor(name: string): string | undefined {
  const scopedName = `${ENV}_${name}`;
  const scoped = nonBlank(process.env[scopedName]);
  if (scoped !== undefined) {
    resolvedSources.set(name, scopedName);
    return scoped;
  }
  const plain = process.env[name];
  resolvedSources.set(name, plain !== undefined ? name : "(unset)");
  return plain;
}

/** e.g. "SIGNING_PRIVATE_KEY←PREPROD_SIGNING_PRIVATE_KEY, BAP_ID←BAP_ID". */
export function envSourceSummary(): string {
  return [...resolvedSources.entries()]
    .map(([name, source]) => `${name}←${source}`)
    .join(", ");
}
