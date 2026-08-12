import { NextRequest, NextResponse } from "next/server";
import { buildMlbProps } from "@/lib/props";
import { parsePropsTiming } from "@/lib/timing";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Ensure background noon/4pm scheduler is alive even if instrumentation skipped.
  const { startPropsAutoPull } = await import("@/lib/props-auto-pull");
  startPropsAutoPull();

  const timing = parsePropsTiming(req.nextUrl.searchParams.get("timing"));
  try {
    const data = await buildMlbProps(timing);
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Props failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
