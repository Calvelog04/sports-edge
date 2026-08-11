import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  cookieName,
  createSessionToken,
  parseSessionToken,
  sessionCookieOptions,
  userIsPaid,
} from "@/lib/auth";
import { addPaymentEvent, readPaymentSettings, toPublicSettings } from "@/lib/payments";
import { getUserById, updateUser, userHasPaidAccess } from "@/lib/users";

export const dynamic = "force-dynamic";

async function requireUser(request: NextRequest) {
  const token = request.cookies.get(cookieName("user"))?.value;
  const session = await parseSessionToken(token, "user");
  if (!session.ok || !session.userId) return null;
  const user = await getUserById(session.userId);
  if (!user || user.status === "disabled") return null;
  return { session, user };
}

export async function GET(request: NextRequest) {
  const ctx = await requireUser(request);
  if (!ctx) {
    return NextResponse.json({ error: "User login required" }, { status: 401 });
  }
  const settings = toPublicSettings(await readPaymentSettings());
  const pro = settings.plans.find((p) => p.id === "pro") ?? settings.plans[1];
  return NextResponse.json({
    user: {
      id: ctx.user.id,
      email: ctx.user.email,
      name: ctx.user.name,
      plan: ctx.user.plan,
      status: ctx.user.status,
      paid: userHasPaidAccess(ctx.user),
    },
    proPlan: pro
      ? {
          id: pro.id,
          name: pro.name,
          priceMonthlyCents: pro.priceMonthlyCents,
          priceAnnualCents: pro.priceAnnualCents,
          features: pro.features,
          currency: settings.currency,
        }
      : null,
    sessionPaid: userIsPaid(ctx.session),
  });
}

/** Mark the current user as paid (Pro) and refresh the session cookie. */
export async function POST(request: NextRequest) {
  const ctx = await requireUser(request);
  if (!ctx) {
    return NextResponse.json({ error: "User login required" }, { status: 401 });
  }

  const settings = await readPaymentSettings();
  const pro = settings.plans.find((p) => p.id === "pro");
  const amount = pro?.priceMonthlyCents ?? 2000;

  const user = await updateUser(ctx.user.id, { plan: "pro" });
  await addPaymentEvent({
    userId: user.id,
    email: user.email,
    planId: "pro",
    amountCents: amount,
    currency: settings.currency || "usd",
    status: "paid",
    note: "Pro unlock from account paywall",
  }).catch(() => undefined);

  const token = await createSessionToken("user", { userId: user.id, plan: "pro" });
  const res = NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      plan: user.plan,
      paid: true,
    },
  });
  res.cookies.set(cookieName("user"), token, sessionCookieOptions());
  return res;
}
