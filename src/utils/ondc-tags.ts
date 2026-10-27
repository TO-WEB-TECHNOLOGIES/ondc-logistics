/**
 * Helpers for ONDC `tags` arrays ({ code, list: [{ code, value }] }) when
 * exposing them on app-facing stream events.
 */
type TagLike = {
  code: string;
  list?: Array<{ code: string; value?: string | null }>;
};

/** Raw tags with `list` always present, for passthrough on events. */
export const normalizeTags = (tags: TagLike[] | undefined) =>
  (tags ?? []).map((t) => ({
    code: t.code,
    list: (t.list ?? []).map((l) => ({ code: l.code, value: l.value ?? undefined })),
  }));

/**
 * Flattens one tag group into { listCode: value }, keeping the contract's own
 * codes as keys (e.g. bpp_terms → { max_liability: "2", ... }). Returns
 * undefined when the group is absent or empty.
 */
export const tagListToRecord = (
  tags: TagLike[] | undefined,
  code: string,
): Record<string, string> | undefined => {
  const group = tags?.find((t) => t.code === code);
  if (!group?.list?.length) return undefined;
  const record: Record<string, string> = {};
  for (const item of group.list)
    if (item.code && item.value !== undefined && item.value !== null)
      record[item.code] = item.value;
  return Object.keys(record).length ? record : undefined;
};
