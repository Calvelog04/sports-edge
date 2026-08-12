import Stripe from "stripe";
import {
  addPaymentEvent,
  findPaymentEventByExternalId,
  getResolvedStripeKeys,
  readPaymentSettings,
  type PaymentInterval,
} from "@/lib/payments";
import { getUserById, updateUser, type ManagedUser } from "@/lib/users";

export async function getStripe(): Promise<Stripe | null> {
  const { secretKey } = await getResolvedStripeKeys();
  if (!secretKey) return null;
  return new Stripe(secretKey);
}

export async function unlockProFromPayment(opts: {
  userId: string;
  email: string;
  amountCents: number;
  currency: string;
  note: string;
  stripeCustomerId?: string | null;
  stripeSessionId?: string | null;
}): Promise<ManagedUser> {
  if (opts.stripeSessionId) {
    const existing = await findPaymentEventByExternalId(opts.stripeSessionId);
    if (existing?.status === "paid") {
      const user = await getUserById(opts.userId);
      if (user?.plan === "pro") return user;
    }
  }

  const patch: {
    plan: "pro";
    stripeCustomerId?: string | null;
  } = { plan: "pro" };
  if (opts.stripeCustomerId) {
    patch.stripeCustomerId = opts.stripeCustomerId;
  }
  const user = await updateUser(opts.userId, patch);

  if (opts.stripeSessionId) {
    const existing = await findPaymentEventByExternalId(opts.stripeSessionId);
    if (existing?.status === "paid") return user;
  }

  await addPaymentEvent({
    userId: user.id,
    email: opts.email || user.email,
    planId: "pro",
    amountCents: opts.amountCents,
    currency: opts.currency || "usd",
    status: "paid",
    method: "card",
    note: opts.note,
    externalId: opts.stripeSessionId ?? null,
  }).catch(() => undefined);
  return user;
}

export async function createProCheckoutSession(opts: {
  userId: string;
  email: string;
  interval: PaymentInterval;
  origin: string;
}): Promise<{ url: string; sessionId: string }> {
  const stripe = await getStripe();
  if (!stripe) {
    throw new Error(
      "Stripe is not configured. Add STRIPE_SECRET_KEY in .env.local or set keys in Management → Payments.",
    );
  }

  const settings = await readPaymentSettings();
  if (settings.provider !== "stripe") {
    throw new Error("Set payment provider to Stripe in Management → Payments.");
  }

  const pro = settings.plans.find((p) => p.id === "pro" && p.active);
  if (!pro) throw new Error("Pro plan is not active.");

  const amount =
    opts.interval === "year" ? pro.priceAnnualCents : pro.priceMonthlyCents;
  if (amount <= 0) throw new Error("Pro plan price must be greater than zero.");

  const user = await getUserById(opts.userId);
  const successUrl = `${opts.origin}/account?checkout=success&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${opts.origin}/account?checkout=cancel`;

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    client_reference_id: opts.userId,
    ...(user?.stripeCustomerId
      ? { customer: user.stripeCustomerId }
      : { customer_email: opts.email }),
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: (settings.currency || "usd").toLowerCase(),
          unit_amount: amount,
          recurring: {
            interval: opts.interval === "year" ? "year" : "month",
          },
          product_data: {
            name: "MintPicks Pro",
            description:
              opts.interval === "year"
                ? "Annual Pro access — research boards unlocked"
                : "Monthly Pro access — research boards unlocked",
          },
        },
      },
    ],
    metadata: {
      userId: opts.userId,
      planId: "pro",
      interval: opts.interval,
      app: "mintpicks",
    },
    subscription_data: {
      metadata: {
        userId: opts.userId,
        planId: "pro",
      },
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
    payment_method_types: ["card"],
  });

  if (!session.url) throw new Error("Stripe did not return a checkout URL.");
  return { url: session.url, sessionId: session.id };
}

export function venmoPayUrl(username: string, amountCents: number, note: string): string {
  const handle = username.replace(/^@/, "").trim();
  const amount = (amountCents / 100).toFixed(2);
  const params = new URLSearchParams({
    txn: "pay",
    audience: "private",
    amount,
    note,
  });
  return `https://venmo.com/${encodeURIComponent(handle)}?${params.toString()}`;
}
