import { NextResponse } from "next/server";
import {
  cookieName,
  createSessionToken,
  sessionCookieOptions,
  type UserPlanClaim,
} from "@/lib/auth";
import { loginOrCreateMember, userHasPaidAccess } from "@/lib/users";

function readEmail(request: Request, form: FormData | null, body: { email?: string } | null): string {
  if (form) return String(form.get("email") ?? "");
  if (body?.email) return String(body.email);
  return "";
}

/** User login — members cannot see betting boards until plan is Pro (paid). */
export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  let email = "";

  try {
    if (contentType.includes("application/json")) {
      const body = (await request.json()) as { email?: string };
      email = readEmail(request, null, body);
    } else {
      const form = await request.formData();
      email = readEmail(request, form, null);
    }
  } catch {
    email = "";
  }

  try {
    const user = await loginOrCreateMember(email);
    const plan: UserPlanClaim = userHasPaidAccess(user) ? "pro" : "free";
    const token = await createSessionToken("user", { userId: user.id, plan });
    const dest = plan === "pro" ? "/" : "/account";
    const res = NextResponse.redirect(new URL(dest, request.url), 303);
    res.cookies.set(cookieName("user"), token, sessionCookieOptions());
    // Clear guest app session so paywall is not bypassed
    res.cookies.set(cookieName("app"), "", { ...sessionCookieOptions(0), maxAge: 0 });
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not sign in";
    const login = new URL("/login", request.url);
    login.searchParams.set("error", msg);
    login.searchParams.set("mode", "user");
    return NextResponse.redirect(login, 303);
  }
}
