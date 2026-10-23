import Anthropic from "@anthropic-ai/sdk";
import { lessonJsonSchema } from "@nl/schema";

// The project's key is stored as ANTHROPIC_NEWSELA_API_KEY in some environments.
const apiKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_NEWSELA_API_KEY;
// Explicit base URL, so a host-level ANTHROPIC_BASE_URL (e.g. a dev tool's proxy) is never inherited.
const baseURL = process.env.GENERATION_API_BASE_URL || "https://api.anthropic.com";
const client = new Anthropic({ apiKey, baseURL, maxRetries: 2, timeout: 10 * 60 * 1000 });

export const MODEL = process.env.GENERATION_MODEL || "claude-opus-5-5";
const MAX_TOKENS = Number(process.env.GENERATION_MAX_TOKENS || 32000);
const SCHEMA = lessonJsonSchema();

// USD per million tokens. A model missing here (e.g. a server-side fallback) is
// priced at the highest rate listed, so the spend cap errs on the safe side.
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
};
const MAX_PRICE = { input: 5, output: 25 };

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

export function costUsd(model: string, u: Usage) {
  const p = PRICES[model] ?? MAX_PRICE;
  const input = u.input_tokens + 1.25 * (u.cache_creation_input_tokens ?? 0) + 0.1 * (u.cache_read_input_tokens ?? 0);
  return (input * p.input + u.output_tokens * p.output) / 1_000_000;
}

export type Generation =
  | { kind: "ok"; json: unknown; model: string; usage: Usage }
  | { kind: "refused"; model: string; usage: Usage; detail: string }
  | { kind: "truncated" | "unparseable"; model: string; usage: Usage };

/** One lesson, one request. Streams so long outputs don't hit HTTP timeouts. */
export async function generateLesson(system: string, user: string): Promise<Generation> {
  if (process.env.GENERATION_FAKE === "1") return fakeLesson(user);
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    system,
    messages: [{ role: "user", content: user }],
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
  });
  const msg = await stream.finalMessage();
  const usage = msg.usage as Usage;
  const model = msg.model;
  if (msg.stop_reason === "refusal") {
    return { kind: "refused", model, usage, detail: JSON.stringify(msg.stop_details ?? null) };
  }
  if (msg.stop_reason === "max_tokens") return { kind: "truncated", model, usage };
  const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  try {
    return { kind: "ok", json: JSON.parse(text), model, usage };
  } catch {
    return { kind: "unparseable", model, usage };
  }
}

/**
 * Local development only: a placeholder lesson so the queue, checks and screens
 * can be exercised without an API key. It is deliberately incomplete, so the
 * output checks flag it.
 */
function fakeLesson(user: string): Generation {
  if (process.env.NODE_ENV === "production") throw new Error("GENERATION_FAKE is not allowed in production.");
  const n = Number(/Write lesson (\d+)/.exec(user)?.[1] ?? 0);
  const part = (title: string, minutes: number) => ({
    title,
    minutes,
    standards: [],
    blocks: [{ type: "teacher_move", move: "say", text: "Placeholder text from GENERATION_FAKE.", standards: [], choices: [] }],
  });
  const json = {
    frontMatter: {
      lessonNumber: n,
      lessonType: "Placeholder",
      title: `Placeholder lesson ${n}`,
      durationMinutes: 50,
      focusStandards: [],
      supportingStandards: [],
      eldStandards: [],
      objectives: { content: "", language: "", foundationalSkills: "" },
      essentialQuestions: [],
      connections: { knowledgeBuilding: "", enduringUnderstanding: "", futureLessons: "", performanceTask: "" },
      vocabulary: [],
      routines: [],
      texts: [],
    },
    sections: [
      { kind: "launch", minutes: 15, purpose: "", parts: [part("Launch", 15)] },
      { kind: "learning_in_action", minutes: 30, purpose: "", parts: [part("Part A", 15), part("Part B", 15)] },
      { kind: "look_back", minutes: 5, purpose: "", parts: [part("Look Back", 5)] },
      { kind: "homework", minutes: 0, purpose: "", parts: [part("Homework", 0)] },
    ],
  };
  return { kind: "ok", json, model: "fake", usage: { input_tokens: 0, output_tokens: 0 } };
}
