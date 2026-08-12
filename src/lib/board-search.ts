/** Client-safe team/player text match for board filters. */

export function normalizeSearchQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}

export function matchesBoardSearch(
  query: string,
  ...fields: Array<string | null | undefined>
): boolean {
  const q = normalizeSearchQuery(query);
  if (!q) return true;
  const hay = fields
    .filter((f): f is string => typeof f === "string" && f.length > 0)
    .join(" ")
    .toLowerCase();
  if (!hay) return false;
  // Every whitespace-separated token must appear somewhere in the haystack.
  return q.split(" ").every((token) => token && hay.includes(token));
}
