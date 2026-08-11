import { NextResponse } from "next/server";
import { cookieName, createSessionToken, sessionCookieOptions } from "@/lib/auth";
import { recordSessionLogin } from "@/lib/users";

/** Management login — users & payments only. */
export async function POST(request: Request) {
  await recordSessionLogin({
    email: "admin@mintpicks.local",
    name: "Admin",
  }).catch(() => undefined);

  const token = await createSessionToken("mgmt");
  const res = NextResponse.redirect(new URL("/management", request.url), 303);
  res.cookies.set(cookieName("mgmt"), token, sessionCookieOptions());
  return res;
}

export async function GET(request: Request) {
  await recordSessionLogin({
    email: "admin@mintpicks.local",
    name: "Admin",
  }).catch(() => undefined);

  const token = await createSessionToken("mgmt");
  const res = NextResponse.redirect(new URL("/management", request.url), 303);
  res.cookies.set(cookieName("mgmt"), token, sessionCookieOptions());
  return res;
}
