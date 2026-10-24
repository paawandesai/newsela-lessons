"use server";

import { revalidatePath } from "next/cache";
import { cancelRun, GenerationError, regenerateLesson, startRun } from "@/lib/generation";
import { enforce, RateLimitError } from "@/lib/ratelimit";
import { requireUser } from "@/lib/session";

type State = { error?: string } | undefined;

async function run(unitId: string, fn: () => Promise<unknown>): Promise<State> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof GenerationError || e instanceof RateLimitError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/units/${unitId}/generate`);
  return undefined;
}

export async function startRunAction(_prev: State, form: FormData) {
  const user = await requireUser("expert");
  const unitId = String(form.get("unitId"));
  return run(unitId, async () => {
    await enforce(`run:${user.id}`, 10, 3600, "generation runs this hour");
    await startRun(unitId, user);
  });
}

export async function cancelRunAction(_prev: State, form: FormData) {
  const user = await requireUser("expert");
  const unitId = String(form.get("unitId"));
  return run(unitId, () => cancelRun(String(form.get("runId")), user));
}

export async function regenerateAction(_prev: State, form: FormData) {
  const user = await requireUser("expert", "reviewer");
  const unitId = String(form.get("unitId"));
  return run(unitId, async () => {
    await enforce(`regen:${user.id}`, 30, 3600, "regenerations this hour");
    await regenerateLesson(String(form.get("lessonId")), user);
  });
}
