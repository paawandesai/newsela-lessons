"use server";

import { revalidatePath } from "next/cache";
import { cancelRun, GenerationError, regenerateLesson, startRun } from "@/lib/generation";
import { requireUser } from "@/lib/session";

type State = { error?: string } | undefined;

async function run(unitId: string, fn: () => Promise<unknown>): Promise<State> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof GenerationError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/units/${unitId}/generate`);
  return undefined;
}

export async function startRunAction(_prev: State, form: FormData) {
  const user = await requireUser("expert");
  const unitId = String(form.get("unitId"));
  return run(unitId, () => startRun(unitId, user));
}

export async function cancelRunAction(_prev: State, form: FormData) {
  const user = await requireUser("expert");
  const unitId = String(form.get("unitId"));
  return run(unitId, () => cancelRun(String(form.get("runId")), user));
}

export async function regenerateAction(_prev: State, form: FormData) {
  const user = await requireUser("expert", "reviewer");
  const unitId = String(form.get("unitId"));
  return run(unitId, () => regenerateLesson(String(form.get("lessonId")), user));
}
