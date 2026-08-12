import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { cookieName, parseSessionToken } from "@/lib/auth";
import { createProCheckoutSession } from "@/lib/stripe-billing";
import type { PaymentInterval } from "@/lib/payments";
import { getUserById } from "@/lib/users";

export const dynamic = "force-dynamic";

async function requireUser(request: NextRequest) {
  const token = request.cookies.get(cookieName("user"))?.value;
  const session = await parseSessionToken(token, "user");
  if (!session.ok || !session.userId) return null;
  const user = await getUserById(session.userId);
  if (!user || user.status === "disabled") return null;
  return { session, user };
}

export async function POST(request: NextRequest) {
  const ctx = await requireUser(request);
  if (!ctx) {
    return NextResponse.json({ error: "User login required" }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      interval?: PaymentInterval;
    };
    const interval: PaymentInterval = body.interval === "year" ? "year" : "month";
    const origin = new URL(request.url).origin;
    const { url, sessionId } = await createProCheckoutSession({
      userId: ctx.user.id,
      email: ctx.user.email,
      interval,
      origin,
    });
    return NextResponse.json({ url, sessionId });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not start checkout" },
      { status: 400 },
    );
  }
}
