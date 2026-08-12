export async function register() {
  // Turbopack/dev sometimes omits NEXT_RUNTIME during register; still start on Node.
  if (process.env.NEXT_RUNTIME === "edge") return;
  console.info("[instrumentation] starting props auto-pull scheduler");
  const { startPropsAutoPull } = await import("./lib/props-auto-pull");
  startPropsAutoPull();
}
