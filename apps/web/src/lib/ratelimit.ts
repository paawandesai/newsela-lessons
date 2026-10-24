import "server-only";
import { Redis } from "ioredis";
import { headers } from "next/headers";

const g = globalThis as unknown as { nlRedis?: Redis };
/** One Redis connection per server process, shared by the queue producer and the rate limiter. */
export function redis() {
  g.nlRedis ??= new Redis(process.env.REDIS_URL || "redis://localhost:6379", { maxRetriesPerRequest: null });
  return g.nlRedis;
}

export class RateLimitError extends Error {}

/** Fixed-window counter: allows `max` calls per `windowSec` for a key, then refuses until the window ends. */
export async function limit(key: string, max: number, windowSec: number): Promise<boolean> {
  const k = `rl:${key}`;
  const [[, count]] = (await redis().multi().incr(k).expire(k, windowSec, "NX").exec()) as [[null, number], unknown];
  return count <= max;
}

/** Counts one failure for a key; `failures` reads the count. Used where only failed attempts should count (sign-in). */
export async function recordFailure(key: string, windowSec: number) {
  const k = `rl:${key}`;
  await redis().multi().incr(k).expire(k, windowSec, "NX").exec();
}
export async function failures(key: string): Promise<number> {
  return Number((await redis().get(`rl:${key}`)) ?? 0);
}

/** Throws a RateLimitError with a readable message once the limit is reached. */
export async function enforce(key: string, max: number, windowSec: number, what: string) {
  if (!(await limit(key, max, windowSec))) throw new RateLimitError(`Too many ${what}. Try again in a few minutes.`);
}

/** The client address as Caddy reports it. The web container is reachable only through Caddy. */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim();
}
