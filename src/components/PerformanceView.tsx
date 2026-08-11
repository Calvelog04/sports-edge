"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import type { PerformanceSnapshot } from "@/lib/performance";
import { SiteNav } from "./SiteNav";

function pct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

function num(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

export function PerformanceView() {
  const [data, setData] = useState<PerformanceSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback(() => {
    startTransition(async () => {
      setError(null);
      try {
        const res = await fetch("/api/performance", { cache: "no-store" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Request failed (${res.status})`);
        }
        setData((await res.json()) as PerformanceSnapshot);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      }
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const p = data?.picks;
  const paper = data?.paper;
  const model = data?.model;

  return (
    <div className="dashboard">
      <header className="topbar">
        <div className="brand-block">
          <p className="brand">MintPicks</p>
          <p className="tagline">Performance — ROI, Brier, CLV, calibration</p>
          <SiteNav />
        </div>
        <div className="header-controls">
          <button type="button" className="refresh-btn" onClick={load} disabled={pending}>
            {pending ? "Loading…" : "Refresh"}
          </button>
        </div>
      </header>

      <div className={`status-banner ${data ? "live" : ""}`}>
        <div>
          <span className="mode-pill">PERF</span>
          <span className="meta">
            {data
              ? `Updated ${new Date(data.generatedAt).toLocaleString()} · ${model?.samplesLearned ?? 0} graded samples in model`
              : "Loading…"}
          </span>
        </div>
      </div>

      {error && <p className="error-banner">{error}</p>}

      <div className="info-grid">
        <section className="info-block">
          <h2 className="info-title">Saved picks</h2>
          <p className="info-copy">
            Win rate {pct(p?.winRate)} · ROI (1u flat) {num(p?.roiPct)}% · units {num(p?.units)}
          </p>
          <p className="info-copy">
            Graded {p?.graded ?? "—"} (W{p?.wins ?? 0}/L{p?.losses ?? 0}/P{p?.pushes ?? 0}) · open{" "}
            {p?.open ?? "—"}
          </p>
          <p className="info-copy">
            Brier {num(p?.brier, 3)} · avg CLV {num(p?.avgClvPct)}%
          </p>
        </section>

        <section className="info-block">
          <h2 className="info-title">Paper book</h2>
          <p className="info-copy">
            Signals the scanner logged for training (not just saved picks). Graded {paper?.graded ?? "—"} ·
            open {paper?.open ?? "—"}
          </p>
          <p className="info-copy">
            Win rate {pct(paper?.winRate)} · Brier {num(paper?.brier, 3)} · avg CLV{" "}
            {num(paper?.avgClvPct)}%
          </p>
        </section>

        <section className="info-block">
          <h2 className="info-title">Model state</h2>
          <p className="info-copy">
            Conviction {num(model?.convictionScale, 2)} · min edge {num(model?.edgeMinPct)}% · last
            train {model?.lastLearnDate ?? "—"}
          </p>
          <p className="info-copy">
            Weight retunes unlock at {model?.minSamplesForWeightTune ?? 15}+ graded samples (currently{" "}
            {model?.samplesLearned ?? 0}).
          </p>
        </section>

        <section className="info-block">
          <h2 className="info-title">Calibration buckets</h2>
          <p className="info-copy">
            Predicted vs actual hit rate by model-prob band. Conviction boosts wait until buckets are
            reliable.
          </p>
          <ul className="rationale">
            {(model?.calibrationBuckets ?? [])
              .filter((b) => b.n > 0)
              .map((b) => (
                <li key={b.label}>
                  ~{b.label}: n={b.n} · pred {pct(b.predicted)} · actual {pct(b.actual)}
                </li>
              ))}
            {(model?.calibrationBuckets ?? []).every((b) => b.n === 0) && (
              <li>No graded samples yet — settle picks / paper to fill buckets.</li>
            )}
          </ul>
        </section>

        <section className="info-block">
          <h2 className="info-title">Recent learn log</h2>
          <ul className="rationale">
            {(model?.dailyLog ?? []).map((d) => (
              <li key={d.date}>
                {d.date}: n={d.samples} · win {pct(d.winRate)} · brier {num(d.brier, 3)}
              </li>
            ))}
            {(model?.dailyLog?.length ?? 0) === 0 && <li>No learn runs yet.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}
