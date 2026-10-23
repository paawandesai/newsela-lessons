import { sql } from "@nl/db/orm";
import { db } from "@nl/db";

export const dynamic = "force-dynamic";

export async function GET() {
  await db.execute(sql`select 1`);
  return Response.json({ ok: true });
}
