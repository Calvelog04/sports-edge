import { NextResponse } from "next/server";
import {
  addPaymentEvent,
  readPaymentEvents,
  readPaymentSettings,
  savePaymentSettings,
  toPublicSettings,
  type BillingMode,
  type PaymentPlan,
  type PaymentProvider,
} from "@/lib/payments";

export const dynamic = "force-dynamic";

export async function GET() {
  const [settings, events] = await Promise.all([
    readPaymentSettings(),
    readPaymentEvents(),
  ]);
  return NextResponse.json({
    settings: toPublicSettings(settings),
    events,
    generatedAt: new Date().toISOString(),
  });
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as {
      provider?: PaymentProvider;
      mode?: BillingMode;
      currency?: string;
      publishableKey?: string;
      secretKey?: string;
      webhookSecret?: string;
      successUrl?: string;
      cancelUrl?: string;
      plans?: PaymentPlan[];
    };
    const settings = await savePaymentSettings(body);
    return NextResponse.json({ settings });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not save payment settings" },
      { status: 400 },
    );
  }
}

/** Record a manual / test payment event (until live Stripe webhooks are connected). */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      email?: string;
      planId?: string;
      amountCents?: number;
      currency?: string;
      status?: "pending" | "paid" | "failed" | "refunded";
      note?: string;
      userId?: string | null;
    };
    if (!body.email?.trim() || !body.planId) {
      return NextResponse.json({ error: "email and planId are required" }, { status: 400 });
    }
    const event = await addPaymentEvent({
      userId: body.userId ?? null,
      email: body.email.trim().toLowerCase(),
      planId: body.planId,
      amountCents: Number(body.amountCents) || 0,
      currency: (body.currency ?? "usd").toLowerCase(),
      status: body.status ?? "paid",
      note: body.note?.trim() ?? "Manual entry from Management",
    });
    return NextResponse.json({ event }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not record payment" },
      { status: 400 },
    );
  }
}
