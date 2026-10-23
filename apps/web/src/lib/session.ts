import "server-only";
import { eq } from "@nl/db/orm";
import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db, users } from "@nl/db";

export type Role = "expert" | "reviewer" | "approver" | "admin";
export type SessionUser = { id: string; name: string; email: string; role: Role };

const COOKIE = "nl_session";
const TTL_SECONDS = 12 * 60 * 60;

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET must be set to at least 32 characters.");
  return new TextEncoder().encode(s);
}

export async function startSession(userId: string) {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(secret());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TTL_SECONDS,
  });
}

export async function endSession() {
  (await cookies()).delete(COOKIE);
}

export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub) return null;
    const [u] = await db.select().from(users).where(eq(users.id, payload.sub));
    return u ? { id: u.id, name: u.name, email: u.email, role: u.role } : null;
  } catch {
    return null;
  }
}

/** Use at the top of every page and server action. Admins pass every role check. */
export async function requireUser(...roles: Role[]): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (roles.length && !roles.includes(user.role) && user.role !== "admin") {
    throw new Error(`This action needs the ${roles.join(" or ")} role.`);
  }
  return user;
}
