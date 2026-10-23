import { Schema, type DOMOutputSpec, type Node as PMNode } from "prosemirror-model";
import * as Y from "yjs";
import { prosemirrorJSONToYDoc, yXmlFragmentToProsemirrorJSON } from "y-prosemirror";
import { Lesson, SECTION_TITLES, type Block } from "./lesson";

/**
 * The collaborative editor's document. It mirrors the Lesson schema one node
 * per field, so a lesson converts to a document and back without loss. Text is
 * plain (no marks) because the lesson format has no inline formatting.
 * Outline-owned data (number, type, standards, vocabulary, texts) rides in one
 * read-only `meta` node; people edit the teaching content around it.
 */

/** The Y.XmlFragment that holds the document inside each lesson's Y.Doc. */
export const FRAGMENT = "lesson";

export const FRONT_FIELDS = {
  "objective.content": "Content objective",
  "objective.language": "Language objective",
  "objective.foundationalSkills": "Foundational skills objective",
  essentialQuestion: "Essential question",
  "connection.knowledgeBuilding": "Knowledge-building",
  "connection.enduringUnderstanding": "Enduring understanding",
  "connection.futureLessons": "Future lessons",
  "connection.performanceTask": "Unit performance task",
} as const;
type FrontKey = keyof typeof FRONT_FIELDS;

export const BLOCK_LABELS: Record<Exclude<Block["type"], "pulse_check">, string> = {
  routine: "Routine",
  teacher_move: "Teacher",
  student_response: "Student response",
  teacher_tip: "Teacher tip",
  reflection: "Reflection",
  sentence_starter: "Sentence starter",
  eld_support: "Integrated ELD",
  student_support: "Additional student support",
};

export const MOVE_LABELS = {
  say: "Say",
  say_directions: "Say these directions",
  ask: "Ask",
  explain: "Explain",
  teach: "Teach",
  model: "Model",
  pause: "Pause",
} as const;

const label = (text: string) => ({ "data-label": text });

export const lessonSchema = new Schema({
  nodes: {
    doc: { content: "lesson_title meta front_field+ section+" },
    text: { group: "inline" },
    lesson_title: { content: "text*", marks: "", toDOM: () => ["h1", { class: "lesson-title" }, 0], parseDOM: [{ tag: "h1" }] },
    meta: {
      atom: true,
      selectable: false,
      attrs: { data: { default: "{}" } },
      toDOM: (node) => metaDOM(node),
      parseDOM: [{ tag: "div.lesson-meta", getAttrs: (d) => ({ data: (d as HTMLElement).dataset.meta ?? "{}" }) }],
    },
    front_field: {
      attrs: { key: { default: "objective.content" } },
      content: "text*",
      marks: "",
      toDOM: (n) => ["p", { class: "front-field", "data-key": n.attrs.key, ...label(FRONT_FIELDS[n.attrs.key as FrontKey] ?? n.attrs.key) }, 0],
    },
    section: {
      attrs: { kind: { default: "launch" }, minutes: { default: 0 }, purpose: { default: "" } },
      content: "part+",
      toDOM: (n) => [
        "section",
        { class: "lesson-section", "data-kind": n.attrs.kind, ...label(`${SECTION_TITLES[n.attrs.kind as keyof typeof SECTION_TITLES] ?? n.attrs.kind} · ${n.attrs.minutes} min`) },
        0,
      ],
    },
    part: {
      attrs: { minutes: { default: 0 }, standards: { default: "" } },
      content: "part_title lesson_block+",
      toDOM: (n) => ["div", { class: "lesson-part", ...label([`${n.attrs.minutes} min`, n.attrs.standards].filter(Boolean).join(" · ")) }, 0],
    },
    part_title: { content: "text*", marks: "", toDOM: () => ["h3", { class: "part-title" }, 0] },
    block: {
      group: "lesson_block",
      attrs: { type: { default: "teacher_move" }, move: { default: null }, standards: { default: "" } },
      content: "text*",
      marks: "",
      toDOM: (n) => ["div", { class: `blk blk-${n.attrs.type}`, ...label(blockLabel(n)) }, 0],
    },
    pulse_check: {
      group: "lesson_block",
      attrs: { standards: { default: "" } },
      content: "pulse_question pulse_choice+",
      toDOM: (n) => ["div", { class: "blk blk-pulse_check", ...label(`Pulse check${n.attrs.standards ? ` · ${n.attrs.standards}` : ""}`) }, 0],
    },
    pulse_question: { content: "text*", marks: "", toDOM: () => ["p", { class: "pulse-question" }, 0] },
    pulse_choice: {
      attrs: { correct: { default: false } },
      content: "choice_text choice_rationale",
      toDOM: (n) => ["div", { class: `pulse-choice${n.attrs.correct ? " is-correct" : ""}`, ...label(n.attrs.correct ? "Correct answer" : "Choice") }, 0],
    },
    choice_text: { content: "text*", marks: "", toDOM: () => ["p", { class: "choice-text" }, 0] },
    choice_rationale: { content: "text*", marks: "", toDOM: () => ["p", { class: "choice-rationale", ...label("Rationale") }, 0] },
  },
  marks: {},
});

function blockLabel(n: PMNode) {
  const t = n.attrs.type as keyof typeof BLOCK_LABELS;
  const base = t === "teacher_move" ? (MOVE_LABELS[n.attrs.move as keyof typeof MOVE_LABELS] ?? "Teacher") : (BLOCK_LABELS[t] ?? t);
  return n.attrs.standards ? `${base} · ${n.attrs.standards}` : base;
}

export type LessonMeta = Pick<
  Lesson["frontMatter"],
  "lessonNumber" | "lessonType" | "durationMinutes" | "focusStandards" | "supportingStandards" | "eldStandards" | "vocabulary" | "routines" | "texts"
>;

function metaDOM(node: PMNode): DOMOutputSpec {
  let m: Partial<LessonMeta> = {};
  try {
    m = JSON.parse(node.attrs.data);
  } catch {}
  const row = (name: string, value: string): DOMOutputSpec => ["div", { class: "meta-row" }, ["dt", name], ["dd", value || "None"]];
  return [
    "div",
    { class: "lesson-meta", "data-meta": node.attrs.data, contenteditable: "false" },
    [
      "dl",
      row("Lesson", `${m.lessonNumber ?? "?"} · ${m.lessonType ?? ""} · ${m.durationMinutes ?? 50} min`),
      row("Focus standards", (m.focusStandards ?? []).join(", ")),
      row("Supporting standards", (m.supportingStandards ?? []).join(", ")),
      row("ELD standards", (m.eldStandards ?? []).join(", ")),
      row("Vocabulary", (m.vocabulary ?? []).join(", ")),
      row("Routines", (m.routines ?? []).join(", ")),
      row("Texts", (m.texts ?? []).map((t) => `${t.title} (${t.locator}; ${t.rights.replace(/_/g, " ")})`).join("; ")),
    ],
  ];
}

// --- Lesson JSON ⇄ ProseMirror JSON ----------------------------------------------

type PMJSON = { type: string; attrs?: Record<string, unknown>; content?: PMJSON[]; text?: string };

const t = (text: string): PMJSON[] => (text ? [{ type: "text", text }] : []);
const textNode = (type: string, text: string, attrs?: Record<string, unknown>): PMJSON => ({ type, ...(attrs && { attrs }), content: t(text) });
const codes = (list: string[]) => list.join(", ");
const splitCodes = (s: unknown) =>
  String(s ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

export function lessonToDoc(lesson: Lesson): PMJSON {
  const fm = lesson.frontMatter;
  const meta: LessonMeta = {
    lessonNumber: fm.lessonNumber,
    lessonType: fm.lessonType,
    durationMinutes: fm.durationMinutes,
    focusStandards: fm.focusStandards,
    supportingStandards: fm.supportingStandards,
    eldStandards: fm.eldStandards,
    vocabulary: fm.vocabulary,
    routines: fm.routines,
    texts: fm.texts,
  };
  const front: PMJSON[] = [
    textNode("front_field", fm.objectives.content, { key: "objective.content" }),
    textNode("front_field", fm.objectives.language, { key: "objective.language" }),
    textNode("front_field", fm.objectives.foundationalSkills, { key: "objective.foundationalSkills" }),
    ...(fm.essentialQuestions.length ? fm.essentialQuestions : [""]).map((q) => textNode("front_field", q, { key: "essentialQuestion" })),
    textNode("front_field", fm.connections.knowledgeBuilding, { key: "connection.knowledgeBuilding" }),
    textNode("front_field", fm.connections.enduringUnderstanding, { key: "connection.enduringUnderstanding" }),
    textNode("front_field", fm.connections.futureLessons, { key: "connection.futureLessons" }),
    textNode("front_field", fm.connections.performanceTask, { key: "connection.performanceTask" }),
  ];
  return {
    type: "doc",
    content: [
      textNode("lesson_title", fm.title),
      { type: "meta", attrs: { data: JSON.stringify(meta) } },
      ...front,
      ...lesson.sections.map((s) => ({
        type: "section",
        attrs: { kind: s.kind, minutes: s.minutes, purpose: s.purpose },
        content: (s.parts.length ? s.parts : [{ title: "", minutes: s.minutes, standards: [], blocks: [] }]).map((p) => ({
          type: "part",
          attrs: { minutes: p.minutes, standards: codes(p.standards) },
          content: [textNode("part_title", p.title), ...(p.blocks.length ? p.blocks.map(blockToNode) : [blockToNode({ type: "teacher_move", move: "say", text: "" })])],
        })),
      })),
    ],
  };
}

function blockToNode(b: Block): PMJSON {
  switch (b.type) {
    case "pulse_check":
      return {
        type: "pulse_check",
        attrs: { standards: codes(b.standards) },
        content: [
          textNode("pulse_question", b.question),
          ...(b.choices.length ? b.choices : [{ text: "", correct: true, rationale: "" }]).map((c) => ({
            type: "pulse_choice",
            attrs: { correct: c.correct },
            content: [textNode("choice_text", c.text), textNode("choice_rationale", c.rationale)],
          })),
        ],
      };
    case "routine":
      return textNode("block", b.name, { type: "routine", move: null, standards: "" });
    case "teacher_move":
      return textNode("block", b.text, { type: "teacher_move", move: b.move, standards: "" });
    case "reflection":
      return textNode("block", b.prompt, { type: "reflection", move: null, standards: "" });
    case "eld_support":
      return textNode("block", b.text, { type: "eld_support", move: null, standards: codes(b.standards) });
    default:
      return textNode("block", b.text, { type: b.type, move: null, standards: "" });
  }
}

const textOf = (n?: PMJSON): string => (n?.content ?? []).map((c) => c.text ?? "").join("");
const childrenOf = (n: PMJSON, type: string) => (n.content ?? []).filter((c) => c.type === type);

/** The inverse of lessonToDoc. Throws if the document is not a lesson. */
export function docToLesson(doc: PMJSON): Lesson {
  const meta = JSON.parse(String(childrenOf(doc, "meta")[0]?.attrs?.data ?? "{}")) as LessonMeta;
  const fields = childrenOf(doc, "front_field");
  const field = (key: FrontKey) => textOf(fields.find((f) => f.attrs?.key === key));
  const lesson = {
    frontMatter: {
      ...meta,
      title: textOf(childrenOf(doc, "lesson_title")[0]),
      objectives: { content: field("objective.content"), language: field("objective.language"), foundationalSkills: field("objective.foundationalSkills") },
      essentialQuestions: fields.filter((f) => f.attrs?.key === "essentialQuestion").map(textOf).filter(Boolean),
      connections: {
        knowledgeBuilding: field("connection.knowledgeBuilding"),
        enduringUnderstanding: field("connection.enduringUnderstanding"),
        futureLessons: field("connection.futureLessons"),
        performanceTask: field("connection.performanceTask"),
      },
    },
    sections: childrenOf(doc, "section").map((s) => ({
      kind: s.attrs?.kind,
      minutes: Number(s.attrs?.minutes ?? 0),
      purpose: String(s.attrs?.purpose ?? ""),
      parts: childrenOf(s, "part").map((p) => ({
        title: textOf(childrenOf(p, "part_title")[0]),
        minutes: Number(p.attrs?.minutes ?? 0),
        standards: splitCodes(p.attrs?.standards),
        blocks: (p.content ?? []).filter((b) => b.type === "block" || b.type === "pulse_check").map(nodeToBlock),
      })),
    })),
  };
  return Lesson.parse(lesson);
}

function nodeToBlock(n: PMJSON): Block {
  if (n.type === "pulse_check") {
    return {
      type: "pulse_check",
      standards: splitCodes(n.attrs?.standards),
      question: textOf(childrenOf(n, "pulse_question")[0]),
      choices: childrenOf(n, "pulse_choice").map((c) => ({
        text: textOf(childrenOf(c, "choice_text")[0]),
        correct: !!c.attrs?.correct,
        rationale: textOf(childrenOf(c, "choice_rationale")[0]),
      })),
    };
  }
  const text = textOf(n);
  const type = n.attrs?.type as Exclude<Block["type"], "pulse_check">;
  switch (type) {
    case "routine":
      return { type, name: text };
    case "teacher_move":
      return { type, move: (n.attrs?.move ?? "say") as keyof typeof MOVE_LABELS, text };
    case "reflection":
      return { type, prompt: text };
    case "eld_support":
      return { type, standards: splitCodes(n.attrs?.standards), text };
    default:
      return { type, text };
  }
}

// --- Yjs ---------------------------------------------------------------------------

/** A Yjs update holding the lesson as a fresh collaborative document. */
export function lessonToYUpdate(lesson: Lesson): Uint8Array {
  const ydoc = prosemirrorJSONToYDoc(lessonSchema, lessonToDoc(lesson), FRAGMENT);
  return Y.encodeStateAsUpdate(ydoc);
}

/** Reads the lesson back out of a stored Yjs state or a live Y.Doc. */
export function lessonFromY(source: Uint8Array | Y.Doc): Lesson {
  let ydoc: Y.Doc;
  if (source instanceof Y.Doc) ydoc = source;
  else {
    ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, source);
  }
  return docToLesson(yXmlFragmentToProsemirrorJSON(ydoc.getXmlFragment(FRAGMENT)) as PMJSON);
}
