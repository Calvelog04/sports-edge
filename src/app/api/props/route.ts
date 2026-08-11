import { NextRequest, NextResponse } from "next/server";
import { buildMlbProps } from "@/lib/props";
import { parseTiming } from "@/lib/timing";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const timing = parseTiming(req.nextUrl.searchParams.get("timing"));
  try {
    const data = await buildMlbProps(timing);
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Props failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
