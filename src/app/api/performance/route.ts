import { NextResponse } from "next/server";
import { buildPerformance } from "@/lib/performance";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await buildPerformance();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load performance" },
      { status: 500 },
    );
  }
}
