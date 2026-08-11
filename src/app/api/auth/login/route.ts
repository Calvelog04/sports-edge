import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { cookieName, credentialsRequired, parseSessionToken, userIsPaid } from "@/lib/auth";

/** Status check only. */
export async function GET(request: NextRequest) {
  const appOk = (await parseSessionToken(request.cookies.get(cookieName("app"))?.value, "app")).ok;
  const userSession = await parseSessionToken(
    request.cookies.get(cookieName("user"))?.value,
    "user",
  );
  const mgmtOk = (await parseSessionToken(request.cookies.get(cookieName("mgmt"))?.value, "mgmt"))
    .ok;
  return NextResponse.json({
    authenticated: appOk || userIsPaid(userSession),
    guestAuthenticated: appOk,
    userAuthenticated: userSession.ok,
    userPaid: userIsPaid(userSession),
    managementAuthenticated: mgmtOk,
    authRequired: true,
    credentialsRequired: credentialsRequired(),
  });
}
