"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  pickIdentityKeys,
  type PickIdentity,
} from "@/lib/pick-identity";

type StoredPickLite = PickIdentity & { status?: string; commenceTime?: string };

let keys = new Set<string>();
const listeners = new Set<() => void>();
let loadPromise: Promise<void> | null = null;

function emit() {
  for (const l of listeners) l();
}

function setKeys(next: Set<string>) {
  keys = next;
  emit();
}

function ingest(picks: StoredPickLite[]) {
  const next = new Set<string>();
  for (const p of picks) {
    if (p.status && p.status !== "open") continue;
    for (const k of pickIdentityKeys(p)) next.add(k);
  }
  setKeys(next);
}

function ensureLoaded(): Promise<void> {
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const res = await fetch("/api/picks", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { picks?: StoredPickLite[] };
        ingest(Array.isArray(body.picks) ? body.picks : []);
      } catch {
        // board still works without saved-state overlay
      }
    })();
  }
  return loadPromise;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return keys;
}

/**
 * Tracks open saved picks so boards can show "already saved"
 * even after edge / model win% refresh. Shared across all cards.
 */
export function useSavedPicks() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    void ensureLoaded();
  }, []);

  const isSaved = useCallback(
    (identity: PickIdentity) => pickIdentityKeys(identity).some((k) => snapshot.has(k)),
    [snapshot],
  );

  const markSaved = useCallback((identity: PickIdentity) => {
    const next = new Set(keys);
    for (const k of pickIdentityKeys(identity)) next.add(k);
    setKeys(next);
  }, []);

  return { isSaved, markSaved };
}
