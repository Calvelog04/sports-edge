import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type Stripe from "stripe";
import {
  findPaymentEventByExternalId,
  getResolvedStripeKeys,
} from "@/lib/payments";
import { getStripe, unlockProFromPayment } from "@/lib/stripe-billing";
import { getUserById } from "@/lib/users";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const externalId = session.id;
  const existing = await findPaymentEventByExternalId(externalId);
  if (existing?.status === "paid") return;

  const userId =
    session.client_reference_id ||
    session.metadata?.userId ||
    null;
  if (!userId) return;

  const user = await getUserById(userId);
  if (!user) return;

  const amount =
    typeof session.amount_total === "number" && session.amount_total > 0
      ? session.amount_total
      : 0;
  const customerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id ?? null;

  await unlockProFromPayment({
    userId: user.id,
    email: user.email,
    amountCents: amount,
    currency: session.currency || "usd",
    note: `Stripe Checkout ${session.mode} · ${externalId}`,
    stripeCustomerId: customerId,
    stripeSessionId: externalId,
  });
}

export async function POST(request: NextRequest) {
  const stripe = await getStripe();
  const { webhookSecret } = await getResolvedStripeKeys();
  if (!stripe || !webhookSecret) {
    return NextResponse.json(
      { error: "Stripe webhook is not configured" },
      { status: 503 },
    );
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature" }, { status: 400 });
  }

  const rawBody = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Invalid webhook signature" },
      { status: 400 },
    );
  }

  try {
    if (event.type === "checkout.session.completed") {
      await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Webhook handler failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true });
}
