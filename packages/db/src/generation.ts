import type { PromptInput, RowContext } from "@nl/schema";
import type { outlineRows, units } from "./schema";

/** BullMQ queue shared by the web app (producer) and the worker (consumer). */
export const GENERATE_QUEUE = "generate";
export type GenerateJobData = { jobId: string };

type Row = typeof outlineRows.$inferSelect;
type Unit = typeof units.$inferSelect;

export function idempotencyKey(unitId: string, lessonNumber: number, promptVersion: number, regen?: string) {
  return [unitId, lessonNumber, `v${promptVersion}`, regen].filter(Boolean).join(":");
}

/** What a generated lesson is checked against. Quotes and page numbers must appear in the row text. */
export function rowContext(row: Row): RowContext {
  return {
    lessonNumber: row.lessonNumber,
    days: row.days ? Number(row.days) : 1,
    focusStandards: row.focusStandards,
    supportingStandards: row.supportingStandards,
    eldStandards: row.eldStandards,
    vocabulary: row.vocabulary,
    sourceText: Object.values(row.raw).join("\n"),
  };
}

const present = (t: string | null) => (t && !/^n\/?a$/i.test(t.trim()) ? t : "");
const summary = (r: Row) =>
  `Lesson ${r.lessonNumber} (${r.lessonType ?? "lesson"}): ${present(r.textDependentQuestion) || present(r.description).slice(0, 160)}`.trim();

export function promptInput(unit: Unit, row: Row, previous?: Row, next?: Row): PromptInput {
  return {
    unitTitle: unit.title,
    anchorText: unit.anchorText,
    row: {
      ...rowContext(row),
      lessonType: row.lessonType ?? "",
      lessonGroup: row.lessonGroup ?? "",
      textDependentQuestion: row.textDependentQuestion ?? "",
      description: row.description ?? "",
      textSet: row.textSet ?? "",
      homework: row.homework ?? "",
      performanceTaskSkill: row.performanceTaskSkill ?? "",
      foundationalSkills: row.foundationalSkills ?? "",
    },
    constraints: row.confirmedConstraints,
    neighbors: { previous: previous && summary(previous), next: next && summary(next) },
  };
}
