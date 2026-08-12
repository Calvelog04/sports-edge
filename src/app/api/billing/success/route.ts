import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  cookieName,
  createSessionToken,
  parseSessionToken,
  sessionCookieOptions,
} from "@/lib/auth";
import { findPaymentEventByExternalId } from "@/lib/payments";
import { getStripe, unlockProFromPayment } from "@/lib/stripe-billing";
import { getUserById, userHasPaidAccess } from "@/lib/users";

export const dynamic = "force-dynamic";

/** Confirm Checkout success (covers local/dev when webhooks are delayed) and refresh session. */
export async function GET(request: NextRequest) {
  const token = request.cookies.get(cookieName("user"))?.value;
  const session = await parseSessionToken(token, "user");
  if (!session.ok || !session.userId) {
    return NextResponse.json({ error: "User login required" }, { status: 401 });
  }

  const sessionId = new URL(request.url).searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.json({ error: "session_id required" }, { status: 400 });
  }

  const stripe = await getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe is not configured" }, { status: 503 });
  }

  try {
    const checkout = await stripe.checkout.sessions.retrieve(sessionId);
    if (checkout.payment_status !== "paid" && checkout.status !== "complete") {
      return NextResponse.json({ error: "Payment not completed yet" }, { status: 402 });
    }

    const userId =
      checkout.client_reference_id ||
      checkout.metadata?.userId ||
      session.userId;
    if (userId !== session.userId) {
      return NextResponse.json({ error: "Session mismatch" }, { status: 403 });
    }

    let user = await getUserById(session.userId);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const already = await findPaymentEventByExternalId(sessionId);
    if (!userHasPaidAccess(user) || !already) {
      const customerId =
        typeof checkout.customer === "string"
          ? checkout.customer
          : checkout.customer?.id ?? null;
      user = await unlockProFromPayment({
        userId: user.id,
        email: user.email,
        amountCents: checkout.amount_total ?? 0,
        currency: checkout.currency || "usd",
        note: `Stripe Checkout confirmed · ${sessionId}`,
        stripeCustomerId: customerId,
        stripeSessionId: sessionId,
      });
    } else if (!userHasPaidAccess(user)) {
      user = await unlockProFromPayment({
        userId: user.id,
        email: user.email,
        amountCents: checkout.amount_total ?? 0,
        currency: checkout.currency || "usd",
        note: `Stripe Checkout confirmed · ${sessionId}`,
        stripeSessionId: sessionId,
      });
    }

    const newToken = await createSessionToken("user", {
      userId: user.id,
      plan: "pro",
    });
    const res = NextResponse.json({
      ok: true,
      paid: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        plan: user.plan,
      },
    });
    res.cookies.set(cookieName("user"), newToken, sessionCookieOptions());
    return res;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not confirm payment" },
      { status: 400 },
    );
  }
}
