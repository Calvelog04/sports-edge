import { NextResponse } from "next/server";
import {
  addPaymentEvent,
  readPaymentEvents,
  readPaymentSettings,
  savePaymentSettings,
  toPublicSettings,
  updatePaymentEvent,
  type BillingMode,
  type PaymentPlan,
  type PaymentProvider,
} from "@/lib/payments";
import { getUserByEmail, getUserById, updateUser } from "@/lib/users";

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
      venmoBusinessUsername?: string;
      venmoDisplayName?: string;
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

/** Record a manual payment, or confirm a pending Venmo payment (unlocks Pro). */
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
      confirmEventId?: string;
      unlockUser?: boolean;
    };

    if (body.confirmEventId) {
      const event = await updatePaymentEvent(body.confirmEventId, {
        status: "paid",
        note: body.note?.trim() || "Venmo payment confirmed in Management",
      });
      let unlocked = false;
      if (event.userId) {
        await updateUser(event.userId, { plan: "pro" });
        unlocked = true;
      } else if (event.email) {
        const user = await getUserByEmail(event.email);
        if (user) {
          await updateUser(user.id, { plan: "pro" });
          unlocked = true;
        }
      }
      return NextResponse.json({ event, unlocked });
    }

    if (!body.email?.trim() || !body.planId) {
      return NextResponse.json({ error: "email and planId are required" }, { status: 400 });
    }

    let userId = body.userId ?? null;
    const email = body.email.trim().toLowerCase();
    if (!userId) {
      const user = await getUserByEmail(email);
      userId = user?.id ?? null;
    }

    const event = await addPaymentEvent({
      userId,
      email,
      planId: body.planId,
      amountCents: Number(body.amountCents) || 0,
      currency: (body.currency ?? "usd").toLowerCase(),
      status: body.status ?? "paid",
      method: "manual",
      note: body.note?.trim() ?? "Manual entry from Management",
    });

    let unlocked = false;
    if ((body.unlockUser ?? true) && body.planId === "pro" && (body.status ?? "paid") === "paid") {
      if (userId) {
        await updateUser(userId, { plan: "pro" });
        unlocked = true;
      } else {
        const user = await getUserByEmail(email);
        if (user) {
          await updateUser(user.id, { plan: "pro" });
          unlocked = true;
        }
      }
    }

    // Ensure user exists reference is valid
    if (userId) await getUserById(userId).catch(() => null);

    return NextResponse.json({ event, unlocked }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not record payment" },
      { status: 400 },
    );
  }
}
