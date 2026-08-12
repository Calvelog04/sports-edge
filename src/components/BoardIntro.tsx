import Link from "next/link";

const COPY: Record<
  "edges" | "suggested" | "best" | "props",
  { line: string; tip?: { href: string; label: string } }
> = {
  edges: {
    line: "Soft book prices — where the model sees the biggest edge vs the line.",
    tip: { href: "/best", label: "Start with Best" },
  },
  suggested: {
    line: "Highest model win% moneylines — who the model thinks will win.",
    tip: { href: "/best", label: "Want both win% and edge? Open Best" },
  },
  best: {
    line: "High model win% and a real sportsbook edge — the overlap board.",
  },
  props: {
    line: "MLB hits & home runs (plus 1st-inning when available). Upcoming: noon credits + 4pm ESPN. Live: ESPN in-play props.",
  },
};

export function BoardIntro({ board }: { board: keyof typeof COPY }) {
  const c = COPY[board];
  return (
    <p className="board-intro">
      {c.line}
      {c.tip ? (
        <>
          {" "}
          <Link href={c.tip.href} className="board-intro-link">
            {c.tip.label}
          </Link>
        </>
      ) : null}
    </p>
  );
}
