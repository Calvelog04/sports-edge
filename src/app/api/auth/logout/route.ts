import { NextResponse } from "next/server";
import { cookieName, sessionCookieOptions } from "@/lib/auth";

type Scope = "app" | "user" | "mgmt" | "all";

function clearCookie(res: NextResponse, kind: "app" | "user" | "mgmt") {
  res.cookies.set(cookieName(kind), "", { ...sessionCookieOptions(0), maxAge: 0 });
}

function parseScope(raw: string | null | undefined): Scope {
  if (raw === "user" || raw === "mgmt" || raw === "all" || raw === "app") return raw;
  return "app";
}

/** Clears sessions. Default: app → /login */
export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  let scope: Scope = "app";

  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    try {
      const form = await request.formData();
      scope = parseScope(String(form.get("scope") ?? "app"));
    } catch {
      // keep default
    }
  } else if (contentType.includes("application/json")) {
    try {
      const body = (await request.json()) as { scope?: string };
      scope = parseScope(body.scope);
    } catch {
      // keep default
    }
  }

  let dest = "/login";
  if (scope === "mgmt") dest = "/login?next=/management";
  if (scope === "user") dest = "/login?mode=user";

  const res = NextResponse.redirect(new URL(dest, request.url), 303);
  if (scope === "app" || scope === "all") clearCookie(res, "app");
  if (scope === "user" || scope === "all") clearCookie(res, "user");
  if (scope === "mgmt" || scope === "all") clearCookie(res, "mgmt");
  return res;
}

export async function GET(request: Request) {
  const scope = parseScope(new URL(request.url).searchParams.get("scope"));
  let dest = "/login";
  if (scope === "mgmt") dest = "/login?next=/management";
  if (scope === "user") dest = "/login?mode=user";

  const res = NextResponse.redirect(new URL(dest, request.url), 303);
  if (scope === "app" || scope === "all" || !scope) clearCookie(res, "app");
  if (scope === "user" || scope === "all") clearCookie(res, "user");
  if (scope === "mgmt" || scope === "all") clearCookie(res, "mgmt");
  return res;
}
