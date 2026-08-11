const APP_COOKIE = "mintpicks_session";
const USER_COOKIE = "mintpicks_user";
const MGMT_COOKIE = "mintpicks_mgmt";
const SESSION_DAYS = 14;

export type SessionKind = "app" | "user" | "mgmt";
export type UserPlanClaim = "free" | "pro";

export interface SessionInfo {
  ok: boolean;
  kind?: SessionKind;
  userId?: string;
  plan?: UserPlanClaim;
}

function getPassword(): string | null {
  const p = process.env.AUTH_PASSWORD?.trim();
  return p || null;
}

function getSecret(): string {
  const explicit = process.env.AUTH_SECRET?.trim();
  if (explicit) return explicit;
  return `mintpicks:${getPassword() ?? "open"}`;
}

export function authEnabled(): boolean {
  return true;
}

export function credentialsRequired(): boolean {
  return Boolean(getPassword());
}

export function cookieName(kind: SessionKind = "app"): string {
  if (kind === "mgmt") return MGMT_COOKIE;
  if (kind === "user") return USER_COOKIE;
  return APP_COOKIE;
}

function toBase64Url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  const b64 =
    typeof btoa === "function"
      ? btoa(binary)
      : Buffer.from(bytes).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacSign(message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return toBase64Url(sig);
}

async function hmacVerify(message: string, signature: string): Promise<boolean> {
  const expected = await hmacSign(message);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

export async function createSessionToken(
  kind: SessionKind = "app",
  opts?: { userId?: string; plan?: UserPlanClaim },
): Promise<string> {
  const exp = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  if (kind === "user") {
    const userId = opts?.userId?.trim();
    if (!userId) throw new Error("userId required for user session");
    const plan = opts?.plan === "pro" ? "pro" : "free";
    const payload = `v1.user.${userId}.${plan}.${exp}`;
    const sig = await hmacSign(payload);
    return `${payload}.${sig}`;
  }
  const payload = `v1.${kind}.${exp}`;
  const sig = await hmacSign(payload);
  return `${payload}.${sig}`;
}

export async function parseSessionToken(
  token: string | undefined | null,
  kind: SessionKind,
): Promise<SessionInfo> {
  if (!token) return { ok: false };

  if (kind === "user") {
    const parts = token.split(".");
    if (parts.length !== 6) return { ok: false };
    const [ver, tokenKind, userId, plan, expStr, sig] = parts;
    if (ver !== "v1" || tokenKind !== "user" || !userId || !plan || !expStr || !sig) {
      return { ok: false };
    }
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || Date.now() > exp) return { ok: false };
    const valid = await hmacVerify(`${ver}.user.${userId}.${plan}.${expStr}`, sig);
    if (!valid) return { ok: false };
    if (plan !== "free" && plan !== "pro") return { ok: false };
    return { ok: true, kind: "user", userId, plan };
  }

  const parts = token.split(".");
  if (parts.length !== 4) return { ok: false };
  const [ver, tokenKind, expStr, sig] = parts;
  if (ver !== "v1" || tokenKind !== kind || !expStr || !sig) return { ok: false };
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return { ok: false };
  const valid = await hmacVerify(`${ver}.${tokenKind}.${expStr}`, sig);
  if (!valid) return { ok: false };
  return { ok: true, kind };
}

export async function verifySessionToken(
  token: string | undefined | null,
  kind: SessionKind = "app",
): Promise<boolean> {
  const parsed = await parseSessionToken(token, kind);
  return parsed.ok;
}

export function userIsPaid(info: SessionInfo | null | undefined): boolean {
  return Boolean(info?.ok && info.kind === "user" && info.plan === "pro");
}

export function validateCredentials(_username: string, _password: string): boolean {
  return true;
}

export function sessionCookieOptions(maxAgeSeconds = SESSION_DAYS * 24 * 60 * 60) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
