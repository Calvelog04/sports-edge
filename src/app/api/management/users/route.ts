import { NextResponse } from "next/server";
import {
  createUser,
  deleteUser,
  readUsers,
  updateUser,
  userStats,
  type CreateUserInput,
  type UpdateUserInput,
} from "@/lib/users";

export const dynamic = "force-dynamic";

export async function GET() {
  const users = await readUsers();
  return NextResponse.json({
    users,
    stats: userStats(users),
    generatedAt: new Date().toISOString(),
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreateUserInput;
    const user = await createUser(body);
    return NextResponse.json({ user }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not create user" },
      { status: 400 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as { id?: string } & UpdateUserInput;
    if (!body.id) {
      return NextResponse.json({ error: "User id is required" }, { status: 400 });
    }
    const { id, ...patch } = body;
    const user = await updateUser(id, patch);
    return NextResponse.json({ user });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not update user" },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "User id is required" }, { status: 400 });
    }
    await deleteUser(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not delete user" },
      { status: 400 },
    );
  }
}
