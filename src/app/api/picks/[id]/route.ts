import { NextRequest, NextResponse } from "next/server";
import { deletePick } from "@/lib/picks";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const ok = await deletePick(id);
  if (!ok) return NextResponse.json({ error: "Pick not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
