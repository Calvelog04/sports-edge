import { promises as fs } from "fs";
import path from "path";

export type UserRole = "admin" | "member";
export type UserStatus = "active" | "disabled";
export type UserPlan = "free" | "pro";

export interface ManagedUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  plan: UserPlan;
  notes: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  /** Optional Stripe customer id once billing is wired */
  stripeCustomerId?: string | null;
}

export interface CreateUserInput {
  email: string;
  name?: string;
  role?: UserRole;
  status?: UserStatus;
  plan?: UserPlan;
  notes?: string;
}

export interface UpdateUserInput {
  email?: string;
  name?: string;
  role?: UserRole;
  status?: UserStatus;
  plan?: UserPlan;
  notes?: string;
  stripeCustomerId?: string | null;
}

const DATA_DIR = path.join(process.cwd(), "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

async function ensureStore(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(USERS_FILE);
  } catch {
    const seed: ManagedUser[] = [
      {
        id: crypto.randomUUID(),
        email: "admin@mintpicks.local",
        name: "Admin",
        role: "admin",
        status: "active",
        plan: "pro",
        notes: "Default local admin — edit or replace from Management.",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastLoginAt: null,
        stripeCustomerId: null,
      },
    ];
    await fs.writeFile(USERS_FILE, JSON.stringify(seed, null, 2), "utf8");
  }
}

export async function readUsers(): Promise<ManagedUser[]> {
  await ensureStore();
  try {
    const raw = await fs.readFile(USERS_FILE, "utf8");
    const parsed = JSON.parse(raw) as ManagedUser[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeUsers(users: ManagedUser[]): Promise<void> {
  await ensureStore();
  await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2), "utf8");
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function createUser(input: CreateUserInput): Promise<ManagedUser> {
  const email = normalizeEmail(input.email);
  if (!email || !email.includes("@")) {
    throw new Error("A valid email is required");
  }
  const users = await readUsers();
  if (users.some((u) => u.email === email)) {
    throw new Error("A user with that email already exists");
  }
  const now = new Date().toISOString();
  const user: ManagedUser = {
    id: crypto.randomUUID(),
    email,
    name: (input.name ?? email.split("@")[0] ?? "User").trim() || "User",
    role: input.role ?? "member",
    status: input.status ?? "active",
    plan: input.plan ?? "free",
    notes: input.notes?.trim() ?? "",
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
    stripeCustomerId: null,
  };
  users.unshift(user);
  await writeUsers(users);
  return user;
}

export async function updateUser(id: string, patch: UpdateUserInput): Promise<ManagedUser> {
  const users = await readUsers();
  const idx = users.findIndex((u) => u.id === id);
  if (idx < 0) throw new Error("User not found");

  if (patch.email != null) {
    const email = normalizeEmail(patch.email);
    if (!email.includes("@")) throw new Error("A valid email is required");
    if (users.some((u) => u.email === email && u.id !== id)) {
      throw new Error("A user with that email already exists");
    }
    users[idx]!.email = email;
  }
  if (patch.name != null) users[idx]!.name = patch.name.trim() || users[idx]!.name;
  if (patch.role != null) users[idx]!.role = patch.role;
  if (patch.status != null) users[idx]!.status = patch.status;
  if (patch.plan != null) users[idx]!.plan = patch.plan;
  if (patch.notes != null) users[idx]!.notes = patch.notes;
  if (patch.stripeCustomerId !== undefined) {
    users[idx]!.stripeCustomerId = patch.stripeCustomerId;
  }
  users[idx]!.updatedAt = new Date().toISOString();
  await writeUsers(users);
  return users[idx]!;
}

export async function deleteUser(id: string): Promise<void> {
  const users = await readUsers();
  const next = users.filter((u) => u.id !== id);
  if (next.length === users.length) throw new Error("User not found");
  if (next.filter((u) => u.role === "admin" && u.status === "active").length === 0) {
    throw new Error("Keep at least one active admin");
  }
  await writeUsers(next);
}

export async function getUserById(id: string): Promise<ManagedUser | null> {
  const users = await readUsers();
  return users.find((u) => u.id === id) ?? null;
}

export function userHasPaidAccess(user: ManagedUser | null | undefined): boolean {
  return Boolean(user && user.status === "active" && user.plan === "pro");
}

/** Find or create a member for User login (starts on free until they pay). */
export async function loginOrCreateMember(emailRaw: string): Promise<ManagedUser> {
  const email = normalizeEmail(emailRaw);
  if (!email || !email.includes("@")) {
    throw new Error("Enter a valid email to continue");
  }
  const users = await readUsers();
  const now = new Date().toISOString();
  const existing = users.find((u) => u.email === email);
  if (existing) {
    if (existing.status === "disabled") {
      throw new Error("This account is disabled. Contact support.");
    }
    existing.lastLoginAt = now;
    existing.updatedAt = now;
    await writeUsers(users);
    return existing;
  }
  const user: ManagedUser = {
    id: crypto.randomUUID(),
    email,
    name: email.split("@")[0] || "User",
    role: "member",
    status: "active",
    plan: "free",
    notes: "Created via User login",
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
    stripeCustomerId: null,
  };
  users.unshift(user);
  await writeUsers(users);
  return user;
}

/** Track anonymous / open sign-ins as a local guest user for the management board. */
export async function recordSessionLogin(opts?: {
  email?: string;
  name?: string;
}): Promise<ManagedUser> {
  const users = await readUsers();
  const email = normalizeEmail(opts?.email ?? "guest@mintpicks.local");
  const existing = users.find((u) => u.email === email);
  const now = new Date().toISOString();
  if (existing) {
    existing.lastLoginAt = now;
    existing.updatedAt = now;
    if (opts?.name) existing.name = opts.name.trim() || existing.name;
    await writeUsers(users);
    return existing;
  }
  const user: ManagedUser = {
    id: crypto.randomUUID(),
    email,
    name: opts?.name?.trim() || (email === "guest@mintpicks.local" ? "Guest" : email.split("@")[0]!),
    role: email === "admin@mintpicks.local" ? "admin" : "member",
    status: "active",
    plan: "free",
    notes: email === "guest@mintpicks.local" ? "Auto-created from Sign in." : "",
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
    stripeCustomerId: null,
  };
  users.unshift(user);
  await writeUsers(users);
  return user;
}

export function userStats(users: ManagedUser[]) {
  return {
    total: users.length,
    active: users.filter((u) => u.status === "active").length,
    disabled: users.filter((u) => u.status === "disabled").length,
    admins: users.filter((u) => u.role === "admin").length,
    pro: users.filter((u) => u.plan === "pro").length,
    free: users.filter((u) => u.plan === "free").length,
  };
}
