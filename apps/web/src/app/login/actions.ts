"use server";

import { hash, verify } from "@node-rs/argon2";
import { eq } from "@nl/db/orm";
import { redirect } from "next/navigation";
import { db, users } from "@nl/db";
import { clientIp, failures, recordFailure } from "@/lib/ratelimit";
import { endSession, startSession } from "@/lib/session";

// Verified against when the email is unknown, so a wrong email takes as long as a wrong password.
const dummyHash = hash("not-a-real-password");

export async function login(_prev: { error?: string } | undefined, form: FormData) {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const ip = await clientIp();
  // 10 failed tries per account and 30 per address every 15 minutes.
  const keys = [`login:email:${email}`, `login:ip:${ip}`] as const;
  if ((await failures(keys[0])) >= 10 || (await failures(keys[1])) >= 30)
    return { error: "Too many failed sign-in attempts. Wait 15 minutes and try again." };
  const [u] = await db.select().from(users).where(eq(users.email, email));
  const ok = await verify(u?.passwordHash ?? (await dummyHash), password);
  if (!u || !ok) {
    await Promise.all(keys.map((k) => recordFailure(k, 900)));
    return { error: "Email or password is wrong." };
  }
  await startSession(u.id);
  redirect("/units");
}

export async function logout() {
  await endSession();
  redirect("/login");
}
