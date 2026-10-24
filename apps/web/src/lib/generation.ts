import "server-only";
import { Queue } from "bullmq";
import {
  auditLog,
  db,
  GENERATE_QUEUE,
  generationJobs,
  generationRuns,
  idempotencyKey,
  lessons,
  lessonVersions,
  outlineRows,
  promptVersions,
  unitCapUsd,
  units,
  type Flag,
  type GenerateJobData,
} from "@nl/db";
import { and, asc, desc, eq, inArray } from "@nl/db/orm";
import { redis } from "./ratelimit";
import type { SessionUser } from "./session";

const g = globalThis as unknown as { generateQueue?: Queue<GenerateJobData> };
function queue() {
  g.generateQueue ??= new Queue<GenerateJobData>(GENERATE_QUEUE, {
    connection: redis(),
  });
  return g.generateQueue;
}

const MODEL = process.env.GENERATION_MODEL || "claude-opus-5-5";

export class GenerationError extends Error {}

/** The worker enforces the cap per call; this refuses to queue work that could not start. */
function assertBudget(unit: typeof units.$inferSelect) {
  if (Number(unit.spentUsd) >= unitCapUsd())
    throw new GenerationError(`This unit has used its $${unitCapUsd().toFixed(0)} spend cap. An admin can raise UNIT_SPEND_CAP_USD.`);
}

async function latestPrompt() {
  const p = await db.query.promptVersions.findFirst({ orderBy: desc(promptVersions.version) });
  if (!p) throw new GenerationError("No prompt version exists. Run the seed script.");
  return p;
}

async function enqueue(jobIds: string[]) {
  if (!jobIds.length) return;
  await queue().addBulk(
    jobIds.map((jobId) => ({
      name: "lesson",
      data: { jobId },
      // One retry on API errors. The database row is the idempotency guard; the queue id stops double-queuing.
      opts: { jobId, attempts: 2, backoff: { type: "exponential", delay: 15_000 }, removeOnComplete: 1000, removeOnFail: 1000 },
    })),
  );
}

/**
 * Starts a run for every lesson that has no output from the current prompt
 * version. Jobs already created for (unit, lesson, prompt version) are reused,
 * so pressing Generate twice never pays twice.
 */
export async function startRun(unitId: string, user: SessionUser) {
  const unit = await db.query.units.findFirst({ where: eq(units.id, unitId) });
  if (!unit) throw new GenerationError("Unit not found.");
  if (unit.status === "needs_review") throw new GenerationError("Confirm the outline first.");
  assertBudget(unit);
  const active = await db.query.generationRuns.findFirst({ where: and(eq(generationRuns.unitId, unitId), eq(generationRuns.status, "running")) });
  if (active) return active.id;

  const prompt = await latestPrompt();
  const rows = await db
    .select({ lessonId: lessons.id, lessonNumber: outlineRows.lessonNumber })
    .from(lessons)
    .innerJoin(outlineRows, eq(lessons.outlineRowId, outlineRows.id))
    .where(eq(lessons.unitId, unitId))
    .orderBy(asc(outlineRows.lessonNumber));

  const runId = await db.transaction(async (tx) => {
    const [run] = await tx
      .insert(generationRuns)
      .values({ unitId, promptVersionId: prompt.id, modelId: MODEL, capUsd: unitCapUsd().toFixed(4), createdBy: user.id })
      .returning({ id: generationRuns.id });
    const created = await tx
      .insert(generationJobs)
      .values(rows.map((r) => ({ runId: run!.id, lessonId: r.lessonId, idempotencyKey: idempotencyKey(unitId, r.lessonNumber, prompt.version) })))
      .onConflictDoNothing({ target: generationJobs.idempotencyKey })
      .returning({ id: generationJobs.id });
    // Earlier jobs that never ran (skipped at a cap, or failed) join this run so they get another chance.
    const retry = await tx
      .update(generationJobs)
      .set({ runId: run!.id, status: "queued", error: null })
      .where(
        and(
          inArray(generationJobs.idempotencyKey, rows.map((r) => idempotencyKey(unitId, r.lessonNumber, prompt.version))),
          inArray(generationJobs.status, ["skipped", "failed"]),
        ),
      )
      .returning({ id: generationJobs.id });
    const ids = [...created, ...retry].map((j) => j.id);
    if (!ids.length) {
      await tx.update(generationRuns).set({ status: "completed" }).where(eq(generationRuns.id, run!.id));
    } else {
      await tx.update(units).set({ status: "generating" }).where(eq(units.id, unitId));
    }
    await tx.insert(auditLog).values({ unitId, actorId: user.id, action: "run.started", detail: { runId: run!.id, jobs: ids.length, promptVersion: prompt.version, capUsd: unitCapUsd() } });
    return { id: run!.id, ids };
  });
  await enqueue(runId.ids);
  return runId.id;
}

/** A fresh attempt for one lesson. Not offered once people have edited the lesson. */
export async function regenerateLesson(lessonId: string, user: SessionUser) {
  const lesson = await db.query.lessons.findFirst({ where: eq(lessons.id, lessonId) });
  if (!lesson) throw new GenerationError("Lesson not found.");
  if (lesson.collabState) throw new GenerationError("This lesson has been edited. Regenerating would discard those edits.");
  if (lesson.status === "generating" || lesson.status === "approved") throw new GenerationError("This lesson can't be regenerated right now.");
  const unit = (await db.query.units.findFirst({ where: eq(units.id, lesson.unitId) }))!;
  assertBudget(unit);
  const row = (await db.query.outlineRows.findFirst({ where: eq(outlineRows.id, lesson.outlineRowId) }))!;
  const prompt = await latestPrompt();

  const job = await db.transaction(async (tx) => {
    const [run] = await tx
      .insert(generationRuns)
      .values({ unitId: lesson.unitId, promptVersionId: prompt.id, modelId: MODEL, capUsd: unitCapUsd().toFixed(4), createdBy: user.id })
      .returning({ id: generationRuns.id });
    const [job] = await tx
      .insert(generationJobs)
      .values({ runId: run!.id, lessonId, idempotencyKey: idempotencyKey(lesson.unitId, row.lessonNumber, prompt.version, `regen-${run!.id}`) })
      .returning({ id: generationJobs.id });
    await tx.insert(auditLog).values({ unitId: lesson.unitId, lessonId, actorId: user.id, action: "lesson.regenerate", detail: { runId: run!.id } });
    return job!;
  });
  await enqueue([job.id]);
}

/** Queued jobs are skipped by the worker once their run is no longer running. */
export async function cancelRun(runId: string, user: SessionUser) {
  const [run] = await db
    .update(generationRuns)
    .set({ status: "cancelled" })
    .where(and(eq(generationRuns.id, runId), eq(generationRuns.status, "running")))
    .returning();
  if (run) await db.insert(auditLog).values({ unitId: run.unitId, actorId: user.id, action: "run.cancelled", detail: { runId } });
}

export type LessonStatusRow = {
  lessonId: string;
  lessonNumber: number;
  lessonType: string | null;
  summary: string;
  status: (typeof lessons.$inferSelect)["status"];
  edited: boolean;
  job: { status: string; attempts: number; costUsd: string | null; error: string | null } | null;
  flags: Flag[];
};

export async function getGenerationStatus(unitId: string) {
  const unit = await db.query.units.findFirst({ where: eq(units.id, unitId) });
  if (!unit) return null;
  const run = await db.query.generationRuns.findFirst({ where: eq(generationRuns.unitId, unitId), orderBy: desc(generationRuns.createdAt) });
  const prompt = run ? await db.query.promptVersions.findFirst({ where: eq(promptVersions.id, run.promptVersionId) }) : await latestPrompt();

  const rows = await db
    .select({ lesson: lessons, row: outlineRows })
    .from(lessons)
    .innerJoin(outlineRows, eq(lessons.outlineRowId, outlineRows.id))
    .where(eq(lessons.unitId, unitId))
    .orderBy(asc(outlineRows.lessonNumber));
  const lessonIds = rows.map((r) => r.lesson.id);
  const jobs = lessonIds.length
    ? await db.select().from(generationJobs).where(inArray(generationJobs.lessonId, lessonIds)).orderBy(desc(generationJobs.createdAt))
    : [];
  const versionIds = rows.map((r) => r.lesson.generatedVersionId).filter((v): v is string => !!v);
  const versions = versionIds.length
    ? await db.select({ id: lessonVersions.id, validation: lessonVersions.validation }).from(lessonVersions).where(inArray(lessonVersions.id, versionIds))
    : [];
  const runSpend = run ? Number(run.spentUsd) : 0;

  const list: LessonStatusRow[] = rows.map(({ lesson, row }) => {
    const job = jobs.find((j) => j.lessonId === lesson.id);
    return {
      lessonId: lesson.id,
      lessonNumber: row.lessonNumber,
      lessonType: row.lessonType,
      summary: ([row.textDependentQuestion, row.description].find((t) => t && !/^n\/?a$/i.test(t.trim())) ?? "").split("\n")[0]!.slice(0, 90),
      status: lesson.status,
      edited: !!lesson.collabState,
      job: job ? { status: job.status, attempts: job.attempts, costUsd: job.costUsd, error: job.error } : null,
      flags: versions.find((v) => v.id === lesson.generatedVersionId)?.validation ?? [],
    };
  });
  return { unit, run, prompt, runSpend, unitSpend: Number(unit.spentUsd), unitCap: unitCapUsd(), lessons: list };
}
