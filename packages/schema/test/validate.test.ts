import { describe, expect, it } from "vitest";
import { Lesson, validateLesson, type RowContext } from "../src";

const row: RowContext = {
  lessonNumber: 1,
  days: 1,
  focusStandards: ["RL.6.1"],
  supportingStandards: ["SL.6.1"],
  eldStandards: ["ELD.PI.6.6"],
  vocabulary: ["gloomy"],
  sourceText: "Chapter 1, pp. 3-9. Students note sensory details.",
};

const part = (title: string, minutes: number, standards: string[], blocks: Lesson["sections"][number]["parts"][number]["blocks"] = []) => ({
  title,
  minutes,
  standards,
  blocks,
});

function lesson(overrides: Partial<Lesson["frontMatter"]> = {}, sections?: Lesson["sections"]): Lesson {
  return Lesson.parse({
    frontMatter: {
      lessonNumber: 1,
      lessonType: "Core Reading",
      title: "Setting and mood",
      durationMinutes: 50,
      focusStandards: ["RL.6.1"],
      supportingStandards: ["SL.6.1"],
      eldStandards: ["ELD.PI.6.6"],
      objectives: { content: "c", language: "l", foundationalSkills: "f" },
      essentialQuestions: ["How does setting shape mood?"],
      connections: { knowledgeBuilding: "k", enduringUnderstanding: "e", futureLessons: "f", performanceTask: "p" },
      vocabulary: ["gloomy"],
      routines: ["Turn and Talk"],
      texts: [{ title: "The Sample Novel", source: "A. Writer", kind: "anchor_text", locator: "Ch. 1, pp. 3-9", rights: "reference_only" }],
      ...overrides,
    },
    sections: sections ?? [
      { kind: "launch", minutes: 15, purpose: "p", parts: [part("Warm up", 15, ["SL.6.1"])] },
      {
        kind: "learning_in_action",
        minutes: 30,
        purpose: "p",
        parts: [
          part("Part A", 15, ["RL.6.1"], [
            {
              type: "pulse_check",
              standards: ["RL.6.1"],
              question: "Which detail shows mood?",
              choices: [
                { text: "A", correct: true, rationale: "r" },
                { text: "B", correct: false, rationale: "r" },
              ],
            },
          ]),
          part("Part B", 15, ["RL.6.1"], [{ type: "eld_support", standards: ["ELD.PI.6.6"], text: "Frames for emerging learners." }]),
        ],
      },
      { kind: "look_back", minutes: 5, purpose: "p", parts: [part("Quick Write", 5, [])] },
      { kind: "homework", minutes: 0, purpose: "p", parts: [part("Read Ch. 2", 0, [])] },
    ],
  });
}

const codes = (l: Lesson) => validateLesson(l, row).map((f) => f.code);

describe("validateLesson", () => {
  it("passes a well-formed lesson", () => {
    expect(validateLesson(lesson(), row)).toEqual([]);
  });

  it("catches the wrong total time", () => {
    const l = lesson();
    l.sections[0]!.minutes = 20;
    expect(codes(l)).toContain("duration");
  });

  it("catches unknown codes and untaught focus standards", () => {
    const l = lesson({ focusStandards: ["RL.6.1", "RL.6.99"] });
    l.sections[1]!.parts.forEach((p) => (p.standards = []));
    expect(codes(l)).toEqual(expect.arrayContaining(["unknown_standard", "focus_not_taught"]));
  });

  it("ignores sentence frames when looking for quotations", () => {
    const l = lesson();
    l.sections[0]!.parts[0]!.blocks.push({ type: "sentence_starter", text: 'Try: "I think ___ means ___ because the root ___ means ___."' });
    expect(codes(l)).not.toContain("unsourced_quote");
  });

  it("flags quotes and page numbers not in the outline", () => {
    const l = lesson();
    l.sections[0]!.parts[0]!.blocks.push({ type: "teacher_move", move: "say", text: 'Read aloud: "The fog rolled over the empty harbor like a heavy gray blanket." See p. 42.' });
    expect(codes(l)).toEqual(expect.arrayContaining(["unsourced_quote", "unsourced_page"]));
  });

  it("requires anchor texts to be reference-only", () => {
    const l = lesson({ texts: [{ title: "The Sample Novel", source: "A. Writer", kind: "anchor_text", locator: "Ch. 1", rights: "public_domain" }] });
    expect(codes(l)).toContain("anchor_rights");
  });

  it("flags vocabulary drift, Lexile, and brand names", () => {
    const l = lesson({ vocabulary: ["gloomy", "eerie"] });
    l.sections[0]!.parts[0]!.blocks.push({ type: "teacher_tip", text: "Compare to a Netflix trailer. The text is at a 900 Lexile." });
    expect(codes(l)).toEqual(expect.arrayContaining(["vocabulary_mismatch", "lexile", "brand_names"]));
  });

  it("needs exactly one correct pulse check answer", () => {
    const l = lesson();
    const pc = l.sections[1]!.parts[0]!.blocks[0]!;
    if (pc.type === "pulse_check") pc.choices[1]!.correct = true;
    expect(codes(l)).toContain("pulse_check_answers");
  });
});
