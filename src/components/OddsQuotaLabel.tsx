import type { OddsQuotaInfo } from "@/lib/types";

function formatQuota(q: OddsQuotaInfo | null | undefined): string | null {
  if (!q || q.remaining == null) return null;
  const used = q.used != null ? ` · used ${q.used}` : "";
  const last = q.last != null ? ` · last −${q.last}` : "";
  const slot =
    q.keyCount != null && q.keyCount > 1 && q.activeKeySlot != null
      ? ` · key ${q.activeKeySlot}/${q.keyCount}`
      : "";
  return `Odds API ${q.remaining} left${used}${last}${slot}`;
}

export function OddsQuotaLabel({
  quota,
  cached,
}: {
  quota?: OddsQuotaInfo | null;
  cached?: boolean;
}) {
  const text = formatQuota(quota);
  if (!text && !cached) return null;
  return (
    <span className="odds-quota" title="The Odds API monthly usage credits">
      {text ?? "Odds API"}
      {cached ? " · cached" : ""}
    </span>
  );
}
