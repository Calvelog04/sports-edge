import { NextRequest, NextResponse } from "next/server";
import { addPick, readPicks, type CreatePickInput } from "@/lib/picks";

export const dynamic = "force-dynamic";

export async function GET() {
  const picks = await readPicks();
  return NextResponse.json({ picks });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CreatePickInput;
    if (!body?.eventId || !body?.selection || !body?.market) {
      return NextResponse.json({ error: "Missing pick fields" }, { status: 400 });
    }
    const pick = await addPick(body);
    return NextResponse.json({ pick });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save pick";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
