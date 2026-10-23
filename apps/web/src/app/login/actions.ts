"use server";

import { verify } from "@node-rs/argon2";
import { eq } from "@nl/db/orm";
import { redirect } from "next/navigation";
import { db, users } from "@nl/db";
import { endSession, startSession } from "@/lib/session";

export async function login(_prev: { error?: string } | undefined, form: FormData) {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const [u] = await db.select().from(users).where(eq(users.email, email));
  if (!u || !(await verify(u.passwordHash, password))) return { error: "Email or password is wrong." };
  await startSession(u.id);
  redirect("/units");
}

export async function logout() {
  await endSession();
  redirect("/login");
}
