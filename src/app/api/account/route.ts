import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  cookieName,
  createSessionToken,
  parseSessionToken,
  sessionCookieOptions,
  userIsPaid,
} from "@/lib/auth";
import { readPaymentSettings, toPublicSettings } from "@/lib/payments";
import { venmoPayUrl } from "@/lib/stripe-billing";
import { getUserById, userHasPaidAccess } from "@/lib/users";

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
  const monthly = pro?.priceMonthlyCents ?? 2000;
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
    billing: {
      ready: settings.ready,
      provider: settings.provider,
      venmoConfigured: settings.venmoConfigured,
      venmoBusinessUsername: settings.venmoBusinessUsername,
      venmoDisplayName: settings.venmoDisplayName,
      venmoPayUrl: settings.venmoConfigured
        ? venmoPayUrl(
            settings.venmoBusinessUsername,
            monthly,
            `MintPicks Pro · ${ctx.user.email}`,
          )
        : null,
    },
    sessionPaid: userIsPaid(ctx.session),
  });
}

/** Legacy endpoint — real card checkout is POST /api/billing/checkout. */
export async function POST() {
  return NextResponse.json(
    {
      error:
        "Use card checkout or Venmo from the account page. Free unlocks are disabled.",
    },
    { status: 400 },
  );
}
