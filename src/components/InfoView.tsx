"use client";

import Link from "next/link";
import { SiteNav } from "./SiteNav";

const SECTIONS = [
  {
    title: "What MintPicks does",
    body: [
      "MintPicks compares sportsbook prices (FanDuel, DraftKings, and others) to a probability model. When the model’s chance of winning is higher than the price implies, that difference is the edge.",
      "It covers MLB, NFL, NCAAF, NBA, NCAAB, and NHL for game lines, plus MLB player props for hits, home runs, and first-inning totals.",
    ],
  },
  {
    title: "What “model edge %” means",
    body: [
      "Edge % is not a win probability and not a “bet this” score. It is how far the model’s estimated chance sits above (or below) the chance implied by the book’s price.",
      "Example: the book implies ~45% and the model says ~52% → edge ≈ +7%. A higher positive edge means a larger disagreement in your favor by the model’s math — not that the outcome is likely, and not that you should automatically place the bet.",
      "A +12% edge on a long shot can still lose often; a +2% edge on a favorite can still be valuable over many bets. Rank by edge to find where the model thinks the price is softest, then read the breakdown (form, weather, Statcast, books) before deciding.",
      "Negative or tiny edges are usually filtered out. MintPicks is a research scanner — educational, not betting advice. No edge size means “guaranteed” or “you should take this pick.”",
      "Want the side the model thinks is most likely to win (regardless of soft pricing)? Use Suggested — that board ranks by model win %, not edge %.",
    ],
  },
  {
    title: "Suggested picks",
    body: [
      "Suggested ranks each game’s moneyline by model win probability — who the model believes will win. One pick per game, sorted from highest win % downward.",
      "This is different from Edges: a heavy favorite can top Suggested with ~70% model win% even if the book price has little edge. A long shot can top Edges with a big edge % and a lower win %. Use both boards for different questions.",
    ],
    href: "/suggested",
    linkLabel: "Open Suggested",
  },
  {
    title: "Best picks",
    body: [
      "Best is the overlap of Edges and Suggested: the model must assign a high win probability (≥55%) and the sportsbook price must still show a real edge (≥1.5%).",
      "Fewer picks appear here on purpose — both bars have to clear. Ranked by a blend of win% and edge. Prefer moneyline when it qualifies; otherwise the best qualifying market for that game.",
    ],
    href: "/best",
    linkLabel: "Open Best",
  },
  {
    title: "Edges",
    body: [
      "The Edges board scans moneyline, spread, and total markets. Each card shows the best book price, model probability, edge %, and a short rationale.",
      "Use Live vs Upcoming on Edges for in-progress game results vs the next slate. Live pulls ESPN only (no paid odds APIs). Open the breakdown for book prices, ESPN context, weather, and (for MLB) Baseball Savant Statcast. Props stay upcoming-only.",
    ],
    href: "/",
    linkLabel: "Open Edges",
  },
  {
    title: "Props (MLB)",
    body: [
      "Props focuses on three markets: player to record a hit (Over 0.5 hits), player to record a home run (Over 0.5 HR), and first-inning over/under.",
      "Each card shows a suggested % — the model’s chance that side wins the bet — plus model edge vs the book. Upcoming props auto-pull twice daily (ODDS_TIMEZONE): noon uses paid credits (Odds API / Parlay, ESPN fallback); 4pm refreshes from ESPN only. Live props pull ESPN in-play hits & HRs on demand (no credits). Between upcoming pulls, refresh reuses that cache. 1st-inning totals still need The Odds API.",
    ],
    href: "/props",
    linkLabel: "Open Props",
  },
  {
    title: "Picks & grading",
    body: [
      "Save any edge or prop to Picks. When games finish, Check results grades CORRECT / WRONG / PUSH.",
      "Game lines use The Odds API finals. MLB props (hits, HRs, 1st-inning totals) grade from official MLB box scores — player hits/home runs and first-inning run totals.",
    ],
    href: "/picks",
    linkLabel: "Open Picks",
  },
  {
    title: "How the model thinks",
    body: [
      "Game lines blend learned Elo, ESPN form/history, de-vigged market consensus, weather (totals), and — for MLB — Savant Statcast plus probable pitchers. NBA/NHL/NFL also use a rest/B2B lean from ESPN schedules.",
      "When several independent signals agree, market weight is reduced so the blend trusts form/Statcast/pitching more. Props use player-level Savant expected stats for hit/HR priors when available.",
      "Fractional Kelly (¼ Kelly, capped at 5% bankroll) is shown on edge cards as a sizing hint — not a recommendation to bet.",
    ],
  },
  {
    title: "Self-learning",
    body: [
      "Graded saved picks and the paper book (signals the scanner showed) feed daily training: Elo, calibration buckets, and — only after enough samples — blend-weight / edge-threshold retunes.",
      "Conviction boosts wait until calibration looks reliable. Model performance (ROI, Brier, CLV) is visible in Management login → Perf.",
    ],
  },
  {
    title: "Data sources",
    body: [
      "Odds: The Odds API when keys have credits. Next: ParlayAPI (PARLAY_API_KEY), then SportsGameOdds (SGO_API_KEY), then ESPN’s public scoreboard. Paid odds (Odds API / Parlay / SportsGameOdds) pull at most 12×/day — once per hour from 10am–9pm local (ODDS_TIMEZONE). Refresh and tab changes reuse that hour’s disk cache and do not spend credits. Live Edges uses ESPN only for in-play ML / spread / total. Live Props uses ESPN for in-play hits & HRs (no credits). ESPN has no credit cost. Finals for grading use Odds API scores when available, otherwise ESPN. Out-of-season leagues stay hidden until 1 week before opening day.",
      "Context: ESPN public scoreboard, injuries, team history, and schedules (rest).",
      "MLB: Baseball Savant (team + player expected stats), MLB Stats API probable pitchers, box scores for prop grading.",
      "Weather: Weather Underground when WU_API_KEY is set; otherwise Open-Meteo.",
    ],
  },
  {
    title: "Accounts & payment",
    body: [
      "User login creates a member account. Betting boards stay locked until Pro is paid on the Account page.",
      "Guest sign in is for open research access. Management login is admin-only (users & payments).",
    ],
  },
  {
    title: "Management",
    body: [
      "Use Management login on the Sign in page to open the admin console. It is separate from the research app — users, payment settings, and the Perf dashboard.",
      "User and payment data are stored locally under data/. Live Stripe Checkout can be wired once keys are saved.",
    ],
  },
  {
    title: "Setup notes",
    body: [
      "Add ODDS_API_KEY to .env.local for The Odds API (optional ODDS_API_KEY_2, … for failover). Optional PARLAY_API_KEY (ParlayAPI) and SGO_API_KEY (SportsGameOdds) when Odds API is out. Optional: WU_API_KEY for Weather Underground.",
      "To lock sign-in with a password later, set AUTH_PASSWORD (and optionally AUTH_USERNAME + AUTH_SECRET). For now, Sign in needs no credentials.",
      "Picks, paper book, users, payments, and learned model state are stored locally under data/ on this machine.",
    ],
  },
] as const;

export function InfoView() {
  return (
    <div className="dashboard">
      <header className="topbar">
        <div className="brand-block">
          <p className="brand">MintPicks</p>
          <p className="tagline">How the app works</p>
          <SiteNav />
        </div>
      </header>

      <div className="status-banner live">
        <div>
          <span className="mode-pill">INFO</span>
          <span className="meta">
            Find mispriced lines · edge % ≠ “bet this” · track results to improve
          </span>
        </div>
      </div>

      <div className="info-grid">
        {SECTIONS.map((section) => (
          <section key={section.title} className="info-block">
            <h2 className="info-title">{section.title}</h2>
            {section.body.map((p) => (
              <p key={p} className="info-copy">
                {p}
              </p>
            ))}
            {"href" in section && section.href ? (
              <Link href={section.href} className="info-link">
                {section.linkLabel} →
              </Link>
            ) : null}
          </section>
        ))}
      </div>
    </div>
  );
}
