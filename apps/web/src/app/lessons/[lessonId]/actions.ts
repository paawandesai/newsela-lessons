"use server";

import { revalidatePath } from "next/cache";
import type { Flag } from "@nl/db";
import { approve, LessonError, runChecks, sendBack } from "@/lib/lessons";
import { requireUser } from "@/lib/session";

export type ChecksState = { flags?: Flag[]; error?: string; checkedAt?: string } | undefined;
export type ApprovalState = { error?: string; ok?: string } | undefined;

export async function runChecksAction(_prev: ChecksState, form: FormData): Promise<ChecksState> {
  await requireUser();
  const lessonId = String(form.get("lessonId"));
  try {
    const flags = await runChecks(lessonId);
    revalidatePath(`/lessons/${lessonId}`);
    return { flags, checkedAt: new Date().toISOString() };
  } catch (e) {
    if (e instanceof LessonError) return { error: e.message };
    throw e;
  }
}

export async function approveAction(_prev: ApprovalState, form: FormData): Promise<ApprovalState> {
  const user = await requireUser("approver");
  const lessonId = String(form.get("lessonId"));
  try {
    const hash = await approve(lessonId, user);
    revalidatePath(`/lessons/${lessonId}`);
    return { ok: `Approved. Content hash ${hash.slice(0, 12)}…` };
  } catch (e) {
    if (e instanceof LessonError) return { error: e.message };
    throw e;
  }
}

export async function sendBackAction(_prev: ApprovalState, form: FormData): Promise<ApprovalState> {
  const user = await requireUser("approver", "reviewer");
  const lessonId = String(form.get("lessonId"));
  await sendBack(lessonId, user, String(form.get("note") ?? "").trim());
  revalidatePath(`/lessons/${lessonId}`);
  return { ok: "Sent back to review." };
}
