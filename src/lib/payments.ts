import { promises as fs } from "fs";
import path from "path";

export type BillingMode = "test" | "live";
export type PaymentProvider = "stripe" | "none";

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
  note: string;
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
    successUrl: "/management?billing=success",
    cancelUrl: "/management?billing=cancel",
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
          "Performance dashboard",
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
      plans:
        Array.isArray(parsed.plans) && parsed.plans.length > 0 ? parsed.plans : base.plans,
    };
  } catch {
    return defaultSettings();
  }
}

export function toPublicSettings(settings: PaymentSettings): PaymentSettingsPublic {
  const secretKeySet = Boolean(settings.secretKey.trim());
  const webhookSecretSet = Boolean(settings.webhookSecret.trim());
  const publishableSet = Boolean(settings.publishableKey.trim());
  return {
    provider: settings.provider,
    mode: settings.mode,
    currency: settings.currency,
    publishableKey: settings.publishableKey,
    secretKeySet,
    secretKeyMasked: maskSecret(settings.secretKey),
    webhookSecretSet,
    webhookSecretMasked: maskSecret(settings.webhookSecret),
    successUrl: settings.successUrl,
    cancelUrl: settings.cancelUrl,
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
    // Empty string from client means "keep existing"
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
    return Array.isArray(parsed) ? parsed : [];
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
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  events.unshift(row);
  await fs.writeFile(EVENTS_FILE, JSON.stringify(events.slice(0, 200), null, 2), "utf8");
  return row;
}
