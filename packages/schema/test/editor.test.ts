import { describe, expect, it } from "vitest";
import { docToLesson, lessonFromY, lessonToDoc, lessonToYUpdate, lessonSchema } from "../src/editor";
import { contentHash } from "../src/hash";
import { Lesson } from "../src/lesson";
import { renderUnitHtml } from "../src/render";

// Synthetic lesson: structure only, no real curriculum text.
const lesson: Lesson = Lesson.parse({
  frontMatter: {
    lessonNumber: 7,
    lessonType: "Core Reading",
    title: "Reading for evidence",
    durationMinutes: 50,
    focusStandards: ["RL.6.1"],
    supportingStandards: ["SL.6.1.a"],
    eldStandards: ["ELD.PI.6.6.a"],
    objectives: { content: "Cite evidence.", language: "Explain a claim.", foundationalSkills: "Read fluently." },
    essentialQuestions: ["What makes evidence strong?"],
    connections: { knowledgeBuilding: "k", enduringUnderstanding: "e", futureLessons: "f", performanceTask: "p" },
    vocabulary: ["evidence"],
    routines: ["Turn and Talk"],
    texts: [{ title: "Sample Novel", source: "Sample Press", kind: "anchor_text", locator: "Ch. 2", rights: "reference_only" }],
  },
  sections: [
    { kind: "launch", minutes: 15, purpose: "Hook", parts: [{ title: "Warm up", minutes: 15, standards: ["RL.6.1"], blocks: [
      { type: "routine", name: "Turn and Talk" },
      { type: "teacher_move", move: "ask", text: "What do you notice?" },
      { type: "student_response", text: "I notice <tags> & things." },
    ] }] },
    { kind: "learning_in_action", minutes: 30, purpose: "Practice", parts: [{ title: "Part A", minutes: 30, standards: ["RL.6.1"], blocks: [
      { type: "pulse_check", standards: ["RL.6.1"], question: "Which is evidence?", choices: [
        { text: "A quote", correct: true, rationale: "It is from the text." },
        { text: "A guess", correct: false, rationale: "It is not from the text." },
      ] },
      { type: "eld_support", standards: ["ELD.PI.6.6.a"], text: "Use a frame." },
      { type: "reflection", prompt: "What changed?" },
    ] }] },
    { kind: "look_back", minutes: 5, purpose: "Close", parts: [{ title: "Exit", minutes: 5, standards: [], blocks: [{ type: "sentence_starter", text: "I learned ___" }] }] },
    { kind: "homework", minutes: 0, purpose: "Read", parts: [{ title: "Read", minutes: 0, standards: [], blocks: [{ type: "student_support", text: "Audio version." }] }] },
  ],
});

describe("editor document", () => {
  it("round-trips a lesson through ProseMirror JSON", () => {
    const doc = lessonToDoc(lesson);
    expect(() => lessonSchema.nodeFromJSON(doc).check()).not.toThrow();
    expect(docToLesson(doc)).toEqual(lesson);
  });

  it("round-trips through a Yjs update with a stable hash", () => {
    const back = lessonFromY(lessonToYUpdate(lesson));
    expect(back).toEqual(lesson);
    expect(contentHash(back)).toBe(contentHash(lesson));
  });

  it("escapes text in the HTML export and carries the CCSS notice", () => {
    const html = renderUnitHtml("Unit", [lesson]);
    expect(html).toContain("&lt;tags&gt; &amp; things");
    expect(html).toContain("Council of Chief State School Officers");
  });
});
