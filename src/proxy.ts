import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { cookieName, parseSessionToken, userIsPaid } from "@/lib/auth";

const ACCOUNT_PATHS = new Set(["/account"]);
const ACCOUNT_APIS = ["/api/account"];

function isBettingPath(pathname: string): boolean {
  if (pathname === "/account" || pathname.startsWith("/account/")) return false;
  if (pathname === "/login" || pathname.startsWith("/login")) return false;
  if (pathname.startsWith("/management")) return false;
  if (pathname.startsWith("/api/auth")) return false;
  if (pathname.startsWith("/api/management")) return false;
  if (pathname.startsWith("/api/account")) return false;
  // Everything else in the app is betting/research related for paywall purposes
  if (pathname.startsWith("/api/")) return true;
  if (pathname === "/info") return false; // allow info docs
  return true;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isLoginPage = pathname === "/login";
  const isMgmtPage = pathname === "/management" || pathname.startsWith("/management/");
  const isMgmtApi = pathname.startsWith("/api/management");
  const isAuthApi = pathname.startsWith("/api/auth/");
  const isAccountPage = ACCOUNT_PATHS.has(pathname) || pathname.startsWith("/account/");
  const isAccountApi = ACCOUNT_APIS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  const appToken = request.cookies.get(cookieName("app"))?.value;
  const userToken = request.cookies.get(cookieName("user"))?.value;
  const mgmtToken = request.cookies.get(cookieName("mgmt"))?.value;

  const appSession = await parseSessionToken(appToken, "app");
  const userSession = await parseSessionToken(userToken, "user");
  const mgmtSession = await parseSessionToken(mgmtToken, "mgmt");

  const appOk = appSession.ok;
  const userOk = userSession.ok;
  const mgmtOk = mgmtSession.ok;
  const userPaid = userIsPaid(userSession);

  if (isAuthApi) {
    return NextResponse.next();
  }

  if (isLoginPage) {
    const next = request.nextUrl.searchParams.get("next") ?? "";
    if (next.startsWith("/management") && mgmtOk) {
      return NextResponse.redirect(new URL("/management", request.url));
    }
    if (userOk && !userPaid) {
      return NextResponse.redirect(new URL("/account", request.url));
    }
    if (userOk && userPaid && !next.startsWith("/management")) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    if (!next.startsWith("/management") && !next.startsWith("/account") && appOk && !userOk) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (isMgmtPage || isMgmtApi) {
    if (!mgmtOk) {
      if (isMgmtApi) {
        return NextResponse.json({ error: "Management login required" }, { status: 401 });
      }
      const login = new URL("/login", request.url);
      login.searchParams.set("next", "/management");
      return NextResponse.redirect(login);
    }
    return NextResponse.next();
  }

  if (isAccountPage || isAccountApi) {
    if (!userOk) {
      if (isAccountApi) {
        return NextResponse.json({ error: "User login required" }, { status: 401 });
      }
      const login = new URL("/login", request.url);
      login.searchParams.set("next", "/account");
      login.searchParams.set("mode", "user");
      return NextResponse.redirect(login);
    }
    return NextResponse.next();
  }

  // Betting / research surfaces
  if (isBettingPath(pathname)) {
    // Paid user session unlocks boards
    if (userOk && userPaid) {
      return NextResponse.next();
    }
    // Unpaid user session → paywall only (no guest bypass)
    if (userOk && !userPaid) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          { error: "Payment required. Upgrade to Pro to view betting boards." },
          { status: 402 },
        );
      }
      return NextResponse.redirect(new URL("/account", request.url));
    }
    // Guest Sign in (app session, no user cookie)
    if (appOk) {
      return NextResponse.next();
    }

    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
