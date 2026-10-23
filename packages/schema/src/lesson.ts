import { z } from "zod";

/**
 * The structure of one generated lesson. It mirrors the house lesson format:
 * front matter, then Launch (15), Learning in Action (30), Look Back (5) and
 * Homework, each made of teacher moves and callouts. Kept deliberately flat
 * so it maps cleanly onto the model's structured output and onto ProseMirror.
 */

export const TextKind = z.enum(["anchor_text", "newsela_article", "short_form", "public_domain", "media"]);

export const RightsStatus = z.enum([
  "newsela_owned", // Newsela article: link to it
  "public_domain", // may be excerpted from a supplied source text
  "reference_only", // in copyright: cite by chapter/pages/locator, never quote
  "needs_rights_clearance", // an excerpt the permissions team must clear
]);

export const LessonText = z.object({
  title: z.string(),
  source: z.string().describe("Author, publisher, or collection"),
  kind: TextKind,
  locator: z.string().describe('Where in the text, e.g. "Ch. 9, pp. 139–148". Copy it from the outline; never invent page numbers.'),
  rights: RightsStatus,
});

const Standards = z.array(z.string()).describe("Standard codes exactly as written in the outline row");

export const Block = z.discriminatedUnion("type", [
  z.object({ type: z.literal("routine"), name: z.string().describe('Classroom routine, e.g. "Turn and Talk"') }),
  z.object({
    type: z.literal("teacher_move"),
    move: z.enum(["say", "say_directions", "ask", "explain", "teach", "model", "pause"]),
    text: z.string(),
  }),
  z.object({ type: z.literal("student_response"), text: z.string().describe("An exemplar student answer") }),
  z.object({ type: z.literal("teacher_tip"), text: z.string() }),
  z.object({
    type: z.literal("pulse_check"),
    standards: Standards,
    question: z.string(),
    choices: z.array(z.object({ text: z.string(), correct: z.boolean(), rationale: z.string() })),
  }),
  z.object({ type: z.literal("reflection"), prompt: z.string() }),
  z.object({ type: z.literal("sentence_starter"), text: z.string() }),
  z.object({
    type: z.literal("eld_support"),
    standards: Standards.describe("Designated ELD codes from the outline row"),
    text: z.string().describe("Integrated ELD support for emerging, expanding, and bridging learners"),
  }),
  z.object({ type: z.literal("student_support"), text: z.string() }),
]);
export type Block = z.infer<typeof Block>;

export const Part = z.object({
  title: z.string(),
  minutes: z.number().int(),
  standards: Standards.describe("The codes this part teaches. This is the alignment claim reviewers check."),
  blocks: z.array(Block),
});

export const SectionKind = z.enum(["launch", "learning_in_action", "look_back", "homework"]);

export const Section = z.object({
  kind: SectionKind,
  minutes: z.number().int().describe("0 for homework"),
  purpose: z.string().describe("One sentence for the pacing table"),
  parts: z.array(Part),
});

export const Lesson = z.object({
  frontMatter: z.object({
    lessonNumber: z.number().int(),
    lessonType: z.string(),
    title: z.string(),
    durationMinutes: z.number().int(),
    focusStandards: Standards,
    supportingStandards: Standards,
    eldStandards: Standards,
    objectives: z.object({
      content: z.string(),
      language: z.string(),
      foundationalSkills: z.string(),
    }),
    essentialQuestions: z.array(z.string()),
    connections: z.object({
      knowledgeBuilding: z.string(),
      enduringUnderstanding: z.string(),
      futureLessons: z.string(),
      performanceTask: z.string(),
    }),
    vocabulary: z.array(z.string()),
    routines: z.array(z.string()),
    texts: z.array(LessonText),
  }),
  sections: z.array(Section),
});
export type Lesson = z.infer<typeof Lesson>;

export const SECTION_TITLES: Record<z.infer<typeof SectionKind>, string> = {
  launch: "Launch",
  learning_in_action: "Learning in Action",
  look_back: "Look Back",
  homework: "Homework",
};

/** Default minutes per section in a 50-minute lesson. */
export const SECTION_MINUTES = { launch: 15, learning_in_action: 30, look_back: 5, homework: 0 } as const;

// Keywords the structured-output API rejects. No property in Lesson uses these names.
const UNSUPPORTED = new Set(["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "pattern"]);

/**
 * JSON Schema for the model's structured output. The API accepts anyOf but not
 * oneOf or numeric/string bounds, and needs additionalProperties: false on
 * every object. Zod still checks the parsed output afterwards.
 */
export function lessonJsonSchema(): Record<string, unknown> {
  const fix = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(fix);
    if (!node || typeof node !== "object") return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === "$schema" || UNSUPPORTED.has(k)) continue;
      out[k === "oneOf" ? "anyOf" : k] = fix(v);
    }
    if (out.type === "object") out.additionalProperties = false;
    return out;
  };
  return fix(z.toJSONSchema(Lesson, { target: "draft-2020-12" })) as Record<string, unknown>;
}
