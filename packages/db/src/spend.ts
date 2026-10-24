import { and, eq, sql } from "drizzle-orm";
import type { Db } from "./index";
import { spendDays, units } from "./schema";

/** Cap on everything spent for one unit: all runs, regenerations and AI suggestions. */
export const unitCapUsd = () => Number(process.env.UNIT_SPEND_CAP_USD || 25);
/** Cap on everything spent across all units in one UTC day. */
export const dailyCapUsd = () => Number(process.env.DAILY_SPEND_CAP_USD || 100);

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Reserves `usd` against the unit's cap and today's cap in one transaction.
 * Each is a conditional update on one row, so parallel callers can never
 * reserve past either cap. Returns which cap stopped it, or null on success.
 */
export async function reserveSpend(db: Db, unitId: string, usd: number): Promise<null | "unit" | "daily"> {
  try {
    await db.transaction(async (tx) => {
      const unit = await tx
        .update(units)
        .set({ spentUsd: sql`${units.spentUsd} + ${usd}` })
        .where(and(eq(units.id, unitId), sql`${units.spentUsd} + ${usd} <= ${unitCapUsd()}`))
        .returning({ id: units.id });
      if (!unit.length) throw new CapReached("unit");
      await tx.insert(spendDays).values({ day: today(), spentUsd: "0" }).onConflictDoNothing();
      const day = await tx
        .update(spendDays)
        .set({ spentUsd: sql`${spendDays.spentUsd} + ${usd}` })
        .where(and(eq(spendDays.day, today()), sql`${spendDays.spentUsd} + ${usd} <= ${dailyCapUsd()}`))
        .returning({ day: spendDays.day });
      if (!day.length) throw new CapReached("daily");
    });
    return null;
  } catch (e) {
    if (e instanceof CapReached) return e.cap;
    throw e;
  }
}

/** Trues up a reservation once the real cost is known (delta may be negative). */
export async function settleSpend(db: Db, unitId: string, delta: number) {
  if (!delta) return;
  await db.update(units).set({ spentUsd: sql`greatest(0, ${units.spentUsd} + ${delta})` }).where(eq(units.id, unitId));
  await db.update(spendDays).set({ spentUsd: sql`greatest(0, ${spendDays.spentUsd} + ${delta})` }).where(eq(spendDays.day, today()));
}

class CapReached extends Error {
  constructor(readonly cap: "unit" | "daily") {
    super(`${cap} spend cap reached`);
  }
}
