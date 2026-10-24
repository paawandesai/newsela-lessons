import "server-only";
import { and, asc, eq } from "@nl/db/orm";
import { auditLog, db, lessons, outlineRows, units, type Flag } from "@nl/db";
import { OutlineError, parseOutline, type ParsedOutline } from "@nl/schema";
import type { SessionUser } from "./session";

export async function createUnitFromGrid(
  grid: string[][],
  source: { kind: "upload" | "google_sheet"; ref: string },
  user: SessionUser,
): Promise<string> {
  const outline: ParsedOutline = parseOutline(grid);
  // Lessons are keyed by number, so two rows with one number can't both be stored. Ask for a fixed sheet.
  const dupes = [...new Set(outline.rows.filter((r) => r.flags.some((f) => f.code === "duplicate_lesson")).map((r) => r.lessonNumber))];
  if (dupes.length) throw new OutlineError(`The sheet lists ${dupes.map((n) => `lesson ${n}`).join(", ")} more than once. Fix the Lesson # column and import again.`);
  return db.transaction(async (tx) => {
    const [unit] = await tx
      .insert(units)
      .values({
        title: outline.title,
        grade: outline.grade,
        unitNumber: outline.unitNumber,
        anchorText: outline.anchorText,
        sourceKind: source.kind,
        sourceRef: source.ref,
        flags: outline.unitFlags,
        createdBy: user.id,
      })
      .returning({ id: units.id });
    const rows = await tx
      .insert(outlineRows)
      .values(
        outline.rows.map((r) => ({
          unitId: unit!.id,
          lessonNumber: r.lessonNumber,
          filename: r.filename,
          lessonGroup: r.lessonGroup,
          lessonType: r.lessonType,
          days: r.days === null ? null : String(r.days),
          textDependentQuestion: r.textDependentQuestion,
          description: r.description,
          textSet: r.textSet,
          homework: r.homework,
          focusStandards: r.focusStandards,
          supportingStandards: r.supportingStandards,
          mediaLiteracyCodes: r.mediaLiteracyCodes,
          performanceTaskSkill: r.performanceTaskSkill,
          foundationalSkills: r.foundationalSkills,
          vocabulary: r.vocabulary,
          eldStandards: r.eldStandards,
          raw: r.raw,
          flags: r.flags,
        })),
      )
      .returning({ id: outlineRows.id });
    await tx.insert(lessons).values(rows.map((r) => ({ unitId: unit!.id, outlineRowId: r.id })));
    await tx.insert(auditLog).values({
      unitId: unit!.id,
      actorId: user.id,
      action: "unit.imported",
      detail: { source: source.kind, rows: rows.length },
    });
    return unit!.id;
  });
}

export async function getUnitWithRows(unitId: string) {
  const [unit] = await db.select().from(units).where(eq(units.id, unitId));
  if (!unit) return null;
  const rows = await db.select().from(outlineRows).where(eq(outlineRows.unitId, unitId)).orderBy(asc(outlineRows.lessonNumber));
  return { unit, rows };
}

export type FlagRef = { scope: "unit" } | { scope: "row"; rowId: string };

/** Records who resolved a flag and how. The flag itself stays for the audit trail. */
export async function resolveFlag(unitId: string, ref: FlagRef, index: number, choice: string | undefined, user: SessionUser) {
  const resolution = { by: user.name, at: new Date().toISOString(), note: choice };
  await db.transaction(async (tx) => {
    if (ref.scope === "unit") {
      const [u] = await tx.select().from(units).where(eq(units.id, unitId));
      if (!u) throw new Error("Unit not found");
      const flags = withResolution(u.flags, index, resolution);
      const flag = flags[index]!;
      const patch: Partial<typeof units.$inferInsert> = { flags };
      if (flag.code === "unit_number_conflict" && choice) patch.unitNumber = Number(/\d+/.exec(choice)?.[0]);
      await tx.update(units).set(patch).where(eq(units.id, unitId));
    } else {
      const [r] = await tx.select().from(outlineRows).where(and(eq(outlineRows.id, ref.rowId), eq(outlineRows.unitId, unitId)));
      if (!r) throw new Error("Row not found");
      const flags = withResolution(r.flags, index, resolution);
      const flag = flags[index]!;
      const patch: Partial<typeof outlineRows.$inferInsert> = { flags };
      if (flag.code === "double_lesson_days" && choice) patch.days = choice.startsWith("Two") ? "2" : "1";
      if (flag.code === "reviewer_note") {
        const set = new Set(r.confirmedConstraints);
        if (choice === "use") set.add(flag.message);
        else set.delete(flag.message);
        patch.confirmedConstraints = [...set];
      }
      await tx.update(outlineRows).set(patch).where(eq(outlineRows.id, r.id));
    }
    await tx.insert(auditLog).values({ unitId, actorId: user.id, action: "flag.resolved", detail: { ref, index, choice } });
  });
}

function withResolution(flags: Flag[], index: number, resolution: NonNullable<Flag["resolution"]>): Flag[] {
  if (!flags[index]) throw new Error("Flag not found");
  return flags.map((f, i) => (i === index ? { ...f, resolution } : f));
}

export function unresolvedErrors(unitFlags: Flag[], rows: { flags: Flag[] }[]): number {
  return [...unitFlags, ...rows.flatMap((r) => r.flags)].filter((f) => f.severity === "error" && !f.resolution).length;
}
