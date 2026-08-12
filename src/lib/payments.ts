import { promises as fs } from "fs";
import path from "path";

export type BillingMode = "test" | "live";
export type PaymentProvider = "stripe" | "none";
export type PaymentInterval = "month" | "year";
export type PaymentMethod = "card" | "venmo" | "manual";

export interface PaymentPlan {
  id: string;
  name: string;
  priceMonthlyCents: number;
  priceAnnualCents: number;
  features: string[];
  active: boolean;
}

export interface PaymentSettings {
  provider: PaymentProvider;
  mode: BillingMode;
  currency: string;
  publishableKey: string;
  /** Never return raw to the client — use masked view. */
  secretKey: string;
  webhookSecret: string;
  successUrl: string;
  cancelUrl: string;
  /** Venmo Business profile username (no @). Card fees land in Stripe; move payouts to this Venmo. */
  venmoBusinessUsername: string;
  /** Shown on the account paywall (optional). */
  venmoDisplayName: string;
  plans: PaymentPlan[];
  updatedAt: string;
}

export interface PaymentSettingsPublic {
  provider: PaymentProvider;
  mode: BillingMode;
  currency: string;
  publishableKey: string;
  secretKeySet: boolean;
  secretKeyMasked: string;
  webhookSecretSet: boolean;
  webhookSecretMasked: string;
  successUrl: string;
  cancelUrl: string;
  venmoBusinessUsername: string;
  venmoDisplayName: string;
  venmoConfigured: boolean;
  plans: PaymentPlan[];
  updatedAt: string;
  ready: boolean;
}

export interface PaymentEvent {
  id: string;
  createdAt: string;
  userId: string | null;
  email: string;
  planId: string;
  amountCents: number;
  currency: string;
  status: "pending" | "paid" | "failed" | "refunded";
  method: PaymentMethod;
  note: string;
  externalId?: string | null;
}

const DATA_DIR = path.join(process.cwd(), "data");
const SETTINGS_FILE = path.join(DATA_DIR, "payments.json");
const EVENTS_FILE = path.join(DATA_DIR, "payment-events.json");

function defaultSettings(): PaymentSettings {
  return {
    provider: "none",
    mode: "test",
    currency: "usd",
    publishableKey: "",
    secretKey: "",
    webhookSecret: "",
    successUrl: "/account?checkout=success",
    cancelUrl: "/account?checkout=cancel",
    venmoBusinessUsername: "",
    venmoDisplayName: "",
    plans: [
      {
        id: "free",
        name: "Free",
        priceMonthlyCents: 0,
        priceAnnualCents: 0,
        features: ["Edges board", "Save picks", "Basic learning"],
        active: true,
      },
      {
        id: "pro",
        name: "Pro",
        priceMonthlyCents: 2000,
        priceAnnualCents: 20000,
        features: [
          "Everything in Free",
          "Props + Best + Suggested",
          "Priority rescans",
        ],
        active: true,
      },
    ],
    updatedAt: new Date().toISOString(),
  };
}

function maskSecret(value: string): string {
  const v = value.trim();
  if (!v) return "";
  if (v.length <= 8) return "••••••••";
  return `${v.slice(0, 4)}…${v.slice(-4)}`;
}

function normalizeVenmoUsername(raw: string): string {
  return raw.trim().replace(/^@+/, "");
}

async function ensureFiles(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(SETTINGS_FILE);
  } catch {
    await fs.writeFile(SETTINGS_FILE, JSON.stringify(defaultSettings(), null, 2), "utf8");
  }
  try {
    await fs.access(EVENTS_FILE);
  } catch {
    await fs.writeFile(EVENTS_FILE, "[]", "utf8");
  }
}

export async function readPaymentSettings(): Promise<PaymentSettings> {
  await ensureFiles();
  try {
    const raw = await fs.readFile(SETTINGS_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<PaymentSettings>;
    const base = defaultSettings();
    return {
      ...base,
      ...parsed,
      venmoBusinessUsername: normalizeVenmoUsername(
        parsed.venmoBusinessUsername ?? base.venmoBusinessUsername,
      ),
      venmoDisplayName: (parsed.venmoDisplayName ?? base.venmoDisplayName).trim(),
      plans:
        Array.isArray(parsed.plans) && parsed.plans.length > 0 ? parsed.plans : base.plans,
    };
  } catch {
    return defaultSettings();
  }
}

/** Prefer env keys; fall back to Management-saved keys in data/payments.json. */
export async function getResolvedStripeKeys(): Promise<{
  secretKey: string;
  publishableKey: string;
  webhookSecret: string;
}> {
  const settings = await readPaymentSettings();
  return {
    secretKey: (process.env.STRIPE_SECRET_KEY || settings.secretKey || "").trim(),
    publishableKey: (
      process.env.STRIPE_PUBLISHABLE_KEY ||
      settings.publishableKey ||
      ""
    ).trim(),
    webhookSecret: (
      process.env.STRIPE_WEBHOOK_SECRET ||
      settings.webhookSecret ||
      ""
    ).trim(),
  };
}

export function toPublicSettings(settings: PaymentSettings): PaymentSettingsPublic {
  // Reflect env-backed secrets in "set" flags without exposing values.
  const envSecret = Boolean(process.env.STRIPE_SECRET_KEY?.trim());
  const envWebhook = Boolean(process.env.STRIPE_WEBHOOK_SECRET?.trim());
  const envPub = Boolean(process.env.STRIPE_PUBLISHABLE_KEY?.trim());

  const secretKeySet = envSecret || Boolean(settings.secretKey.trim());
  const webhookSecretSet = envWebhook || Boolean(settings.webhookSecret.trim());
  const publishableKey = (
    process.env.STRIPE_PUBLISHABLE_KEY ||
    settings.publishableKey ||
    ""
  ).trim();
  const publishableSet = envPub || Boolean(publishableKey);
  const venmoBusinessUsername = normalizeVenmoUsername(settings.venmoBusinessUsername);

  return {
    provider: settings.provider,
    mode: settings.mode,
    currency: settings.currency,
    publishableKey,
    secretKeySet,
    secretKeyMasked: maskSecret(
      process.env.STRIPE_SECRET_KEY?.trim() || settings.secretKey,
    ),
    webhookSecretSet,
    webhookSecretMasked: maskSecret(
      process.env.STRIPE_WEBHOOK_SECRET?.trim() || settings.webhookSecret,
    ),
    successUrl: settings.successUrl,
    cancelUrl: settings.cancelUrl,
    venmoBusinessUsername,
    venmoDisplayName: settings.venmoDisplayName,
    venmoConfigured: Boolean(venmoBusinessUsername),
    plans: settings.plans,
    updatedAt: settings.updatedAt,
    ready:
      settings.provider === "stripe" &&
      publishableSet &&
      secretKeySet &&
      settings.plans.some((p) => p.active && p.priceMonthlyCents > 0),
  };
}

export async function savePaymentSettings(
  patch: Partial<{
    provider: PaymentProvider;
    mode: BillingMode;
    currency: string;
    publishableKey: string;
    secretKey: string;
    webhookSecret: string;
    successUrl: string;
    cancelUrl: string;
    venmoBusinessUsername: string;
    venmoDisplayName: string;
    plans: PaymentPlan[];
  }>,
): Promise<PaymentSettingsPublic> {
  const current = await readPaymentSettings();
  const next: PaymentSettings = {
    ...current,
    provider: patch.provider ?? current.provider,
    mode: patch.mode ?? current.mode,
    currency: (patch.currency ?? current.currency).toLowerCase(),
    publishableKey:
      patch.publishableKey !== undefined ? patch.publishableKey.trim() : current.publishableKey,
    secretKey:
      patch.secretKey !== undefined && patch.secretKey.trim() !== ""
        ? patch.secretKey.trim()
        : current.secretKey,
    webhookSecret:
      patch.webhookSecret !== undefined && patch.webhookSecret.trim() !== ""
        ? patch.webhookSecret.trim()
        : current.webhookSecret,
    successUrl: patch.successUrl?.trim() || current.successUrl,
    cancelUrl: patch.cancelUrl?.trim() || current.cancelUrl,
    venmoBusinessUsername:
      patch.venmoBusinessUsername !== undefined
        ? normalizeVenmoUsername(patch.venmoBusinessUsername)
        : current.venmoBusinessUsername,
    venmoDisplayName:
      patch.venmoDisplayName !== undefined
        ? patch.venmoDisplayName.trim()
        : current.venmoDisplayName,
    plans: patch.plans ?? current.plans,
    updatedAt: new Date().toISOString(),
  };
  await ensureFiles();
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(next, null, 2), "utf8");
  return toPublicSettings(next);
}

export async function readPaymentEvents(): Promise<PaymentEvent[]> {
  await ensureFiles();
  try {
    const raw = await fs.readFile(EVENTS_FILE, "utf8");
    const parsed = JSON.parse(raw) as PaymentEvent[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((ev) => ({
      ...ev,
      method: ev.method ?? "manual",
      externalId: ev.externalId ?? null,
    }));
  } catch {
    return [];
  }
}

export async function addPaymentEvent(
  input: Omit<PaymentEvent, "id" | "createdAt">,
): Promise<PaymentEvent> {
  const events = await readPaymentEvents();
  const row: PaymentEvent = {
    ...input,
    method: input.method ?? "manual",
    externalId: input.externalId ?? null,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  events.unshift(row);
  await fs.writeFile(EVENTS_FILE, JSON.stringify(events.slice(0, 200), null, 2), "utf8");
  return row;
}

export async function updatePaymentEvent(
  id: string,
  patch: Partial<Pick<PaymentEvent, "status" | "note" | "externalId" | "method">>,
): Promise<PaymentEvent> {
  const events = await readPaymentEvents();
  const idx = events.findIndex((e) => e.id === id);
  if (idx < 0) throw new Error("Payment event not found");
  const current = events[idx]!;
  const next: PaymentEvent = {
    ...current,
    ...patch,
  };
  events[idx] = next;
  await fs.writeFile(EVENTS_FILE, JSON.stringify(events, null, 2), "utf8");
  return next;
}

export async function findPaymentEventByExternalId(
  externalId: string,
): Promise<PaymentEvent | null> {
  const events = await readPaymentEvents();
  return events.find((e) => e.externalId === externalId) ?? null;
}
