import { and, eq, inArray, sql } from "@nl/db/orm";
import {
  auditLog,
  db,
  generationJobs,
  generationRuns,
  lessons,
  lessonVersions,
  outlineRows,
  promptInput,
  promptVersions,
  rowContext,
  units,
  type Flag,
} from "@nl/db";
import { ZodError } from "zod";
import { buildUserMessage, fromWire, hasBlocking, validateLesson, type Lesson } from "@nl/schema";
import { costUsd, generateLesson, MODEL } from "./claude";

/** Reserved against the run's cap before each call, then trued up to the real cost. */
const ESTIMATE_USD = Number(process.env.GENERATION_ESTIMATE_USD || 0.75);

export async function processJob(jobId: string): Promise<void> {
  const job = await db.query.generationJobs.findFirst({ where: eq(generationJobs.id, jobId) });
  if (!job) return;
  // Idempotent: a finished job is never redone, even if the queue delivers it twice.
  if (["succeeded", "flagged", "skipped", "failed"].includes(job.status)) return;

  const run = await db.query.generationRuns.findFirst({ where: eq(generationRuns.id, job.runId) });
  if (!run || run.status !== "running") {
    await finish(jobId, job.lessonId, "skipped", "pending", { error: "Run is no longer active." });
    return;
  }

  // Reserve budget atomically so parallel jobs can never overshoot the cap.
  const reserved = await db
    .update(generationRuns)
    .set({ spentUsd: sql`${generationRuns.spentUsd} + ${ESTIMATE_USD}` })
    .where(and(eq(generationRuns.id, run.id), eq(generationRuns.status, "running"), sql`${generationRuns.spentUsd} + ${ESTIMATE_USD} <= ${generationRuns.capUsd}`))
    .returning({ id: generationRuns.id });
  if (!reserved.length) {
    await db.update(generationRuns).set({ status: "stopped_at_cap" }).where(and(eq(generationRuns.id, run.id), eq(generationRuns.status, "running")));
    await finish(jobId, job.lessonId, "skipped", "pending", { error: "Spend cap reached." });
    await settleRun(run.id);
    return;
  }

  const lesson = (await db.query.lessons.findFirst({ where: eq(lessons.id, job.lessonId) }))!;
  const row = (await db.query.outlineRows.findFirst({ where: eq(outlineRows.id, lesson.outlineRowId) }))!;
  const unit = (await db.query.units.findFirst({ where: eq(units.id, lesson.unitId) }))!;
  const prompt = (await db.query.promptVersions.findFirst({ where: eq(promptVersions.id, run.promptVersionId) }))!;
  const neighbors = await db.query.outlineRows.findMany({
    where: and(eq(outlineRows.unitId, unit.id), inArray(outlineRows.lessonNumber, [row.lessonNumber - 1, row.lessonNumber + 1])),
  });

  await db.update(generationJobs).set({ status: "running", attempts: sql`${generationJobs.attempts} + 1`, startedAt: new Date() }).where(eq(generationJobs.id, jobId));
  await db.update(lessons).set({ status: "generating", updatedAt: new Date() }).where(eq(lessons.id, lesson.id));

  const input = promptInput(
    unit,
    row,
    neighbors.find((n) => n.lessonNumber === row.lessonNumber - 1),
    neighbors.find((n) => n.lessonNumber === row.lessonNumber + 1),
  );

  let result;
  try {
    result = await generateLesson(prompt.systemPrompt, buildUserMessage(input));
  } catch (e) {
    // Release the reservation; the queue retries once.
    await addSpend(run.id, -ESTIMATE_USD);
    await db.update(generationJobs).set({ status: "queued", error: String(e) }).where(eq(generationJobs.id, jobId));
    throw e;
  }

  const cost = costUsd(result.model, result.usage);
  await addSpend(run.id, cost - ESTIMATE_USD);
  const usage = { inputTokens: result.usage.input_tokens, outputTokens: result.usage.output_tokens, costUsd: cost.toFixed(4) };

  if (result.kind !== "ok") {
    const message = {
      refused: "The model declined to write this lesson. Review the outline row, then regenerate.",
      truncated: "The lesson was cut off at the output limit. Regenerate, or raise GENERATION_MAX_TOKENS.",
      unparseable: "The model's output was not valid JSON.",
    }[result.kind];
    await finish(jobId, lesson.id, "failed", "flagged", { ...usage, error: message });
    await db.insert(auditLog).values({ unitId: unit.id, lessonId: lesson.id, action: "lesson.generation_failed", detail: { reason: result.kind, model: result.model } });
    await settleRun(run.id);
    return;
  }

  // The model writes the flat wire format; what is stored is the Lesson. Unparseable output is kept as-is for inspection.
  let parsed: { success: true; data: Lesson } | { success: false; error: unknown };
  try {
    parsed = { success: true, data: fromWire(result.json) };
  } catch (error) {
    parsed = { success: false, error };
  }
  let flags: Flag[];
  if (parsed.success) {
    flags = validateLesson(parsed.data, rowContext(row));
    if (parsed.data.frontMatter.lessonNumber !== row.lessonNumber)
      flags.push({ code: "lesson_number", severity: "error", message: `Generated as lesson ${parsed.data.frontMatter.lessonNumber}, not ${row.lessonNumber}.` });
  } else {
    flags = [{ code: "invalid_output", severity: "error", message: `Output does not match the lesson format: ${parsed.error instanceof ZodError ? (parsed.error.issues[0]?.message ?? "unknown") : String(parsed.error)}` }];
  }
  const blocked = hasBlocking(flags);

  await db.transaction(async (tx) => {
    const [version] = await tx
      .insert(lessonVersions)
      .values({
        lessonId: lesson.id,
        source: "ai",
        content: (parsed.success ? parsed.data : result.json) as object,
        promptVersionId: prompt.id,
        modelId: result.model,
        generationJobId: jobId,
        validation: flags,
      })
      .returning({ id: lessonVersions.id });
    await tx
      .update(lessons)
      .set({ generatedVersionId: version!.id, status: blocked ? "flagged" : "in_review", updatedAt: new Date() })
      .where(eq(lessons.id, lesson.id));
    await tx
      .update(generationJobs)
      .set({ ...usage, status: blocked ? "flagged" : "succeeded", error: null, finishedAt: new Date() })
      .where(eq(generationJobs.id, jobId));
    await tx.insert(auditLog).values({
      unitId: unit.id,
      lessonId: lesson.id,
      action: "lesson.generated",
      detail: { versionId: version!.id, model: result.model, requestedModel: MODEL, promptVersion: prompt.version, flags: flags.length, costUsd: cost },
    });
  });
  await settleRun(run.id);
}

/** Called by the queue once retries are used up. */
export async function failJob(jobId: string, error: string) {
  const job = await db.query.generationJobs.findFirst({ where: eq(generationJobs.id, jobId) });
  if (!job || ["succeeded", "flagged", "skipped", "failed"].includes(job.status)) return;
  await finish(jobId, job.lessonId, "failed", "flagged", { error });
  await settleRun(job.runId);
}

async function finish(
  jobId: string,
  lessonId: string,
  status: "skipped" | "failed",
  lessonStatus: "pending" | "flagged",
  extra: Partial<typeof generationJobs.$inferInsert>,
) {
  await db.update(generationJobs).set({ ...extra, status, finishedAt: new Date() }).where(eq(generationJobs.id, jobId));
  // Only a lesson this job started is touched. One with an earlier version goes back to review with it.
  await db
    .update(lessons)
    .set({
      status: sql`case when ${lessons.generatedVersionId} is null then ${lessonStatus}::lesson_status else 'in_review'::lesson_status end`,
      updatedAt: new Date(),
    })
    .where(and(eq(lessons.id, lessonId), eq(lessons.status, "generating")));
}

async function addSpend(runId: string, delta: number) {
  await db.update(generationRuns).set({ spentUsd: sql`greatest(0, ${generationRuns.spentUsd} + ${delta})` }).where(eq(generationRuns.id, runId));
}

/** Marks the run (and unit) done once no job is waiting or running. */
async function settleRun(runId: string) {
  const open = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(generationJobs)
    .where(and(eq(generationJobs.runId, runId), inArray(generationJobs.status, ["queued", "running"])));
  if ((open[0]?.n ?? 0) > 0) return;
  const [run] = await db
    .update(generationRuns)
    .set({ status: sql`case when ${generationRuns.status} = 'running' then 'completed'::run_status else ${generationRuns.status} end` })
    .where(eq(generationRuns.id, runId))
    .returning();
  if (run) await db.update(units).set({ status: "in_review" }).where(and(eq(units.id, run.unitId), eq(units.status, "generating")));
}
