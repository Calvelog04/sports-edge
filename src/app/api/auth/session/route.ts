import { NextResponse } from "next/server";
import { cookieName, createSessionToken, sessionCookieOptions } from "@/lib/auth";
import { recordSessionLogin } from "@/lib/users";

function safeNext(raw: string | null): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  // App sign-in never lands on management
  if (raw.startsWith("/management")) return "/";
  return raw;
}

/** App Sign in — research boards only. */
export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  let next = "/";

  if (contentType.includes("application/json")) {
    try {
      const body = (await request.json()) as { next?: string };
      next = safeNext(body.next ?? null);
    } catch {
      next = "/";
    }
  } else {
    try {
      const form = await request.formData();
      next = safeNext(String(form.get("next") ?? "/"));
    } catch {
      next = "/";
    }
  }

  await recordSessionLogin().catch(() => undefined);

  const token = await createSessionToken("app");
  const res = NextResponse.redirect(new URL(next, request.url), 303);
  res.cookies.set(cookieName("app"), token, sessionCookieOptions());
  return res;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const next = safeNext(searchParams.get("next"));
  await recordSessionLogin().catch(() => undefined);
  const token = await createSessionToken("app");
  const res = NextResponse.redirect(new URL(next, request.url), 303);
  res.cookies.set(cookieName("app"), token, sessionCookieOptions());
  return res;
}
