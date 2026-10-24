"use server";

import { revalidatePath } from "next/cache";
import type { Flag } from "@nl/db";
import { approve, LessonError, NeedsConfirmation, runChecks, sendBack } from "@/lib/lessons";
import { enforce, RateLimitError } from "@/lib/ratelimit";
import { requireUser } from "@/lib/session";
import { createSuggestion, resolveSuggestion, type Suggestion, SuggestionError, type SuggestionRequest } from "@/lib/suggestions";

export type ChecksState = { flags?: Flag[]; error?: string; checkedAt?: string } | undefined;
export type ApprovalState = { error?: string; ok?: string; confirm?: string[] } | undefined;

export async function runChecksAction(_prev: ChecksState, form: FormData): Promise<ChecksState> {
  // Re-checking can move a flagged lesson back to review, so it belongs to the people who review.
  await requireUser("reviewer", "approver");
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
    const hash = await approve(lessonId, user, form.get("confirmQuotes") === "yes");
    revalidatePath(`/lessons/${lessonId}`);
    return { ok: `Approved. Content hash ${hash.slice(0, 12)}…` };
  } catch (e) {
    if (e instanceof NeedsConfirmation) return { error: e.message, confirm: e.flags.map((f) => f.message) };
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

export type SuggestResult = { suggestion?: Suggestion; error?: string };

/** Reviewers ask for an AI rewrite of one block. It comes back as a pending suggestion; nothing is applied. */
export async function suggestAction(lessonId: string, req: SuggestionRequest): Promise<SuggestResult> {
  const user = await requireUser("reviewer");
  try {
    await enforce(`suggest:${user.id}`, 60, 3600, "AI suggestions this hour");
    const suggestion = await createSuggestion(lessonId, user, req);
    return { suggestion };
  } catch (e) {
    if (e instanceof SuggestionError || e instanceof RateLimitError) return { error: e.message };
    throw e;
  }
}

/** Called after the browser applied a suggestion to the shared document, or when the reviewer dismisses it. */
export async function resolveSuggestionAction(id: string, status: "applied" | "dismissed" | "stale"): Promise<{ error?: string }> {
  const user = await requireUser("reviewer");
  if (!["applied", "dismissed", "stale"].includes(status)) return { error: "Unknown status." };
  try {
    await resolveSuggestion(id, user, status);
    return {};
  } catch (e) {
    if (e instanceof SuggestionError) return { error: e.message };
    throw e;
  }
}
