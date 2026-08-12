import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { cookieName, parseSessionToken } from "@/lib/auth";
import {
  addPaymentEvent,
  readPaymentSettings,
  type PaymentInterval,
} from "@/lib/payments";
import { venmoPayUrl } from "@/lib/stripe-billing";
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

/** Start a Venmo Business payment — opens Venmo and logs a pending event for Management to confirm. */
export async function POST(request: NextRequest) {
  const ctx = await requireUser(request);
  if (!ctx) {
    return NextResponse.json({ error: "User login required" }, { status: 401 });
  }

  const settings = await readPaymentSettings();
  const username = settings.venmoBusinessUsername.trim();
  if (!username) {
    return NextResponse.json(
      {
        error:
          "Venmo Business username is not set. Add it in Management → Payments.",
      },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    interval?: PaymentInterval;
  };
  const interval: PaymentInterval = body.interval === "year" ? "year" : "month";
  const pro = settings.plans.find((p) => p.id === "pro");
  const amountCents =
    interval === "year"
      ? (pro?.priceAnnualCents ?? 20000)
      : (pro?.priceMonthlyCents ?? 2000);

  const note = `MintPicks Pro ${interval} · ${ctx.user.email}`;
  const event = await addPaymentEvent({
    userId: ctx.user.id,
    email: ctx.user.email,
    planId: "pro",
    amountCents,
    currency: settings.currency || "usd",
    status: "pending",
    method: "venmo",
    note: `Awaiting Venmo confirmation · @${username}`,
  });

  return NextResponse.json({
    ok: true,
    eventId: event.id,
    venmoUsername: username,
    amountCents,
    payUrl: venmoPayUrl(username, amountCents, note),
    message:
      "Complete payment in Venmo. Management will unlock Pro after the payment appears on the business account.",
  });
}
