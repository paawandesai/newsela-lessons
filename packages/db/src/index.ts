import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export * from "./schema";
export { schema };

const url = process.env.DATABASE_URL ?? "postgres://nl:nl@localhost:5432/newsela_lessons";

// One pool per process. Next.js dev reloads modules, so keep it on globalThis.
const globalForDb = globalThis as unknown as { __nlSql?: ReturnType<typeof postgres> };
export const sqlClient = globalForDb.__nlSql ?? postgres(url, { max: Number(process.env.DB_POOL_MAX ?? 10) });
if (process.env.NODE_ENV !== "production") globalForDb.__nlSql = sqlClient;

export const db = drizzle(sqlClient, { schema });
export type Db = typeof db;
