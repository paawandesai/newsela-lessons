import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { aiSuggestions, auditLog, costUsd, db, lessons, reserveSpend, settleSpend, type Usage, worstCaseUsd } from "@nl/db";
import { and, desc, eq } from "@nl/db/orm";
import { buildSuggestionMessage, SUGGESTION_KINDS, SUGGESTION_SYSTEM_PROMPT, suggestionJsonSchema, type SuggestionKind } from "@nl/schema";
import type { SessionUser } from "./session";

const MODEL = process.env.GENERATION_MODEL || "claude-opus-5-5";
const MAX_TOKENS = 8000;
const MAX_TEXT = 4000;
const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_NEWSELA_API_KEY,
  // Explicit, so a host-level ANTHROPIC_BASE_URL (e.g. a dev tool's proxy) is never inherited.
  baseURL: process.env.GENERATION_API_BASE_URL || "https://api.anthropic.com",
  maxRetries: 2,
  timeout: 120_000,
});

export class SuggestionError extends Error {}

export type Suggestion = typeof aiSuggestions.$inferSelect;

export type SuggestionRequest = {
  index: number;
  node: string;
  label: string;
  text: string;
  kind?: SuggestionKind;
  custom?: string;
};

/**
 * Asks the model to rewrite one text block and stores the answer as a pending
 * suggestion. Nothing in the document changes until a reviewer applies it.
 */
export async function createSuggestion(lessonId: string, user: SessionUser, req: SuggestionRequest): Promise<Suggestion> {
  const lesson = await db.query.lessons.findFirst({ where: eq(lessons.id, lessonId) });
  if (!lesson) throw new SuggestionError("Lesson not found.");
  if (lesson.status === "generating") throw new SuggestionError("Wait for generation to finish.");
  const text = req.text.trim();
  if (!text) throw new SuggestionError("Put the cursor in a block that has text.");
  if (text.length > MAX_TEXT) throw new SuggestionError("That block is too long to rewrite in one suggestion.");
  const request = req.kind ? SUGGESTION_KINDS[req.kind] : (req.custom ?? "").trim().slice(0, 300);
  if (!request) throw new SuggestionError("Choose what to change.");

  const version = lesson.generatedVersionId ? await db.query.lessonVersions.findFirst({ where: (v, { eq }) => eq(v.id, lesson.generatedVersionId!) }) : undefined;
  const fm = (version?.content as { frontMatter?: { title?: string; focusStandards?: string[] } } | undefined)?.frontMatter;

  const reserve = worstCaseUsd(6000, MAX_TOKENS);
  const capped = await reserveSpend(db, lesson.unitId, reserve);
  if (capped) throw new SuggestionError(capped === "unit" ? "This unit has used its spend cap." : "Today's spend cap is used up.");

  let out: { text: string; rationale: string; model: string; usage: Usage };
  try {
    out = await ask(buildSuggestionMessage({ lessonTitle: fm?.title ?? "", focusStandards: fm?.focusStandards ?? [], label: req.label, text, request }));
  } catch (e) {
    // The call may have been billed before it failed, so the reservation stays counted.
    throw e instanceof SuggestionError ? e : new SuggestionError("The suggestion could not be generated. Try again.");
  }
  const cost = costUsd(out.model, out.usage);
  await settleSpend(db, lesson.unitId, cost - reserve);

  const [row] = await db
    .insert(aiSuggestions)
    .values({
      lessonId,
      target: { index: req.index, node: req.node, label: req.label },
      instruction: request,
      originalText: req.text,
      suggestedText: out.text.trim(),
      rationale: out.rationale.trim(),
      modelId: out.model,
      costUsd: cost.toFixed(4),
      createdBy: user.id,
    })
    .returning();
  await db.insert(auditLog).values({ unitId: lesson.unitId, lessonId, actorId: user.id, action: "suggestion.created", detail: { suggestionId: row!.id, model: out.model, costUsd: cost } });
  return row!;
}

/** Records that a reviewer applied, dismissed, or could not apply (stale) a suggestion. */
export async function resolveSuggestion(id: string, user: SessionUser, status: "applied" | "dismissed" | "stale") {
  const [row] = await db
    .update(aiSuggestions)
    .set({ status, resolvedBy: user.id, resolvedAt: new Date() })
    .where(and(eq(aiSuggestions.id, id), eq(aiSuggestions.status, "pending")))
    .returning();
  if (!row) throw new SuggestionError("That suggestion was already handled.");
  const lesson = await db.query.lessons.findFirst({ where: eq(lessons.id, row.lessonId) });
  await db.insert(auditLog).values({ unitId: lesson?.unitId, lessonId: row.lessonId, actorId: user.id, action: `suggestion.${status}`, detail: { suggestionId: id } });
  return row;
}

export function listSuggestions(lessonId: string) {
  return db.select().from(aiSuggestions).where(eq(aiSuggestions.lessonId, lessonId)).orderBy(desc(aiSuggestions.createdAt)).limit(30);
}

async function ask(user: string): Promise<{ text: string; rationale: string; model: string; usage: Usage }> {
  if (process.env.GENERATION_FAKE === "1") {
    if (process.env.NODE_ENV === "production") throw new SuggestionError("GENERATION_FAKE is not allowed in production.");
    const original = /<lesson_text[^>]*>\n([\s\S]*)\n<\/lesson_text/.exec(user)?.[1] ?? "";
    return { text: `${original} (Suggested wording from GENERATION_FAKE.)`, rationale: "Placeholder suggestion for local testing.", model: "fake", usage: { input_tokens: 0, output_tokens: 0 } };
  }
  const msg = await client.beta.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "low", format: { type: "json_schema", schema: suggestionJsonSchema } },
    system: SUGGESTION_SYSTEM_PROMPT,
    messages: [{ role: "user", content: user }],
  });
  if (msg.stop_reason === "refusal") throw new SuggestionError("The model declined to rewrite this text.");
  if (msg.stop_reason === "max_tokens") throw new SuggestionError("The suggestion was cut off. Try a shorter block.");
  const raw = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  try {
    const parsed = JSON.parse(raw) as { text?: unknown; rationale?: unknown };
    if (typeof parsed.text !== "string" || !parsed.text.trim()) throw new Error("empty");
    return { text: parsed.text, rationale: String(parsed.rationale ?? ""), model: msg.model, usage: msg.usage as Usage };
  } catch {
    throw new SuggestionError("The model's answer could not be read. Try again.");
  }
}
