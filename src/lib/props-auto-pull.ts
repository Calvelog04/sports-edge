/**
 * Background props pulls while the Node server is running.
 * Noon (credits) and 4pm (ESPN) — see odds-window PROPS_REFRESH_HOURS.
 */

let started = false;
let running = false;

export function startPropsAutoPull(): void {
  if (started) return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  started = true;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const {
        getPropsRefreshSlotId,
        scheduledOddsCacheUrl,
        shouldNetworkFetchProps,
      } = await import("./odds-schedule");
      const slot = getPropsRefreshSlotId();
      if (!slot) return;

      const url = scheduledOddsCacheUrl("props-daily:mlb-board");
      const gate = await shouldNetworkFetchProps(url);
      if (!gate.allow) return;

      console.info(
        `[props-auto-pull] starting ${gate.source} pull for slot ${gate.slotId}`,
      );
      const { buildMlbProps } = await import("./props");
      const board = await buildMlbProps("upcoming");
      console.info(
        `[props-auto-pull] done · mode=${board.mode} · games=${board.eventsScanned} · props=${board.opportunities.length}`,
      );
    } catch (err) {
      console.error("[props-auto-pull]", err);
    } finally {
      running = false;
    }
  };

  setTimeout(() => {
    void tick();
  }, 12_000);
  setInterval(() => {
    void tick();
  }, 60_000);
}
