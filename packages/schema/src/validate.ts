import type { Lesson } from "./lesson";
import type { Flag } from "./outline";
import { extractCodes, isKnownCode, normalizeCode } from "./standards";

/** What a generated lesson is checked against: its outline row, as the expert confirmed it. */
export type RowContext = {
  lessonNumber: number;
  days: number;
  focusStandards: string[];
  supportingStandards: string[];
  eldStandards: string[];
  vocabulary: string[];
  /** All text of the outline row. Quotes and page numbers must come from here. */
  sourceText: string;
};

// Commercial names that California's social content standards ask reviewers to check.
const BRANDS = [
  "Coca-Cola", "Pepsi", "McDonald's", "Nike", "Adidas", "Disney", "Netflix", "Google", "Apple", "iPhone", "Amazon",
  "TikTok", "Instagram", "YouTube", "Starbucks", "Walmart", "Target", "Xbox", "PlayStation", "Nintendo", "Snapchat",
];

const base = (c: string) => normalizeCode(c).base;
const err = (code: string, message: string): Flag => ({ code, severity: "error", message });
const warn = (code: string, message: string): Flag => ({ code, severity: "warning", message });

export function validateLesson(lesson: Lesson, row: RowContext): Flag[] {
  const flags: Flag[] = [];
  const fm = lesson.frontMatter;

  // --- Time -----------------------------------------------------------------
  const kinds = lesson.sections.map((s) => s.kind);
  for (const k of ["launch", "learning_in_action", "look_back", "homework"] as const) {
    if (!kinds.includes(k)) flags.push(err("missing_section", `Missing the ${k.replace(/_/g, " ")} section.`));
  }
  const classMinutes = lesson.sections.filter((s) => s.kind !== "homework").reduce((n, s) => n + s.minutes, 0);
  const expected = 50 * row.days;
  if (classMinutes !== expected) flags.push(err("duration", `Sections total ${classMinutes} minutes, not ${expected}.`));
  for (const s of lesson.sections) {
    const parts = s.parts.reduce((n, p) => n + p.minutes, 0);
    if (s.kind !== "homework" && s.parts.length > 1 && parts !== s.minutes)
      flags.push(warn("part_minutes", `${s.kind.replace(/_/g, " ")} parts total ${parts} minutes, but the section is ${s.minutes}.`));
  }

  // --- Standards --------------------------------------------------------------
  const allowed = new Set([...row.focusStandards, ...row.supportingStandards, ...row.eldStandards].map(base));
  const used = new Set<string>([
    ...fm.focusStandards,
    ...fm.supportingStandards,
    ...fm.eldStandards,
    ...lesson.sections.flatMap((s) => s.parts.flatMap((p) => [...p.standards, ...p.blocks.flatMap((b) => ("standards" in b ? b.standards : []))])),
    ...extractCodes(JSON.stringify(lesson.sections)),
  ]);
  const unknown = [...used].filter((c) => !isKnownCode(c) && !allowed.has(base(c)));
  if (unknown.length) flags.push(err("unknown_standard", `Codes not in the standards list: ${unknown.join(", ")}.`));
  const extra = [...used].filter((c) => isKnownCode(c) && !allowed.has(base(c)));
  if (extra.length) flags.push(warn("standard_not_in_row", `Codes not in the outline row: ${extra.join(", ")}.`));

  const missingFocus = row.focusStandards.filter((c) => !fm.focusStandards.map(base).includes(base(c)));
  if (missingFocus.length) flags.push(err("focus_mismatch", `Front matter is missing focus standards ${missingFocus.join(", ")}.`));
  const taught = new Set(lesson.sections.flatMap((s) => s.parts.flatMap((p) => p.standards.map(base))));
  const untaught = row.focusStandards.filter((c) => !taught.has(base(c)));
  if (untaught.length) flags.push(err("focus_not_taught", `No activity is mapped to ${untaught.join(", ")}.`));

  // --- ELD ------------------------------------------------------------------------
  const eldBlocks = lesson.sections.flatMap((s) => s.parts.flatMap((p) => p.blocks.filter((b) => b.type === "eld_support")));
  if (row.eldStandards.length && eldBlocks.length === 0) flags.push(warn("missing_eld_support", "The row lists ELD codes, but there is no ELD support."));
  if (!row.eldStandards.length && eldBlocks.length) flags.push(warn("unexpected_eld_support", "ELD support was added, but the row lists no ELD codes."));

  // --- Vocabulary -------------------------------------------------------------------
  const want = new Set(row.vocabulary.map((v) => v.toLowerCase()));
  const got = new Set(fm.vocabulary.map((v) => v.toLowerCase()));
  const missingVocab = [...want].filter((v) => !got.has(v));
  const extraVocab = [...got].filter((v) => !want.has(v));
  if (missingVocab.length || extraVocab.length)
    flags.push(
      warn(
        "vocabulary_mismatch",
        [missingVocab.length && `missing ${missingVocab.join(", ")}`, extraVocab.length && `not in the outline: ${extraVocab.join(", ")}`]
          .filter(Boolean)
          .join("; ") + ".",
      ),
    );

  // --- Pulse checks -----------------------------------------------------------------
  for (const s of lesson.sections)
    for (const p of s.parts)
      for (const b of p.blocks)
        if (b.type === "pulse_check" && b.choices.filter((c) => c.correct).length !== 1)
          flags.push(err("pulse_check_answers", `A pulse check in "${p.title}" needs exactly one correct choice.`));

  // --- Texts, quotes, and page numbers --------------------------------------------------
  for (const t of fm.texts)
    if (t.kind === "anchor_text" && !["reference_only", "needs_rights_clearance"].includes(t.rights))
      flags.push(err("anchor_rights", `"${t.title}" is in copyright and must be reference-only or marked for rights clearance.`));

  const strings = stringsIn(lesson);
  const body = strings.join("\n");
  const source = normalizeQuotes(row.sourceText).toLowerCase();
  for (const q of strings.flatMap(quotedSpans)) {
    // A warning, not an error: most hits are model-written examples (a mentor paragraph, a sample claim).
    // The reviewer confirms the words are original and not from the novel or an article.
    if (!source.includes(q.toLowerCase()))
      flags.push(warn("unsourced_quote", `Quoted text not found in the outline. Confirm it is original, not from a source text: "${q.slice(0, 80)}"`));
  }
  for (const pages of body.matchAll(/\bpp?\.\s*(\d+(?:\s*[–-]\s*\d+)?)/g)) {
    const nums = pages[1]!.split(/[–-]/).map((n) => n.trim());
    if (!nums.every((n) => new RegExp(`\\b${n}\\b`).test(row.sourceText)))
      flags.push(err("unsourced_page", `Page reference "${pages[0]}" does not appear in the outline row.`));
  }

  // --- Compliance prompts for the reviewer ---------------------------------------------------
  if (/\blexile\b/i.test(body)) flags.push(warn("lexile", "Mentions Lexile. Use grade-band language instead."));
  const brands = BRANDS.filter((b) => new RegExp(`\\b${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(body));
  if (brands.length) flags.push(warn("brand_names", `Mentions brand names: ${brands.join(", ")}. Check against the social content standards.`));

  return dedupe(flags);
}

function normalizeQuotes(s: string) {
  return s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
}

function stringsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value && typeof value === "object") return Object.values(value).flatMap(stringsIn);
  return [];
}

/** Quoted spans of 8+ words inside one text field: long enough to be a passage, not a label or sentence frame. */
function quotedSpans(text: string): string[] {
  return [...normalizeQuotes(text).matchAll(/"([^"]{20,600})"/g)]
    .map((m) => m[1]!.trim())
    .filter((s) => s.split(/\s+/).length >= 8 && !/__/.test(s)); // "__" marks a sentence frame, not a quotation
}

function dedupe(flags: Flag[]): Flag[] {
  const seen = new Set<string>();
  return flags.filter((f) => !seen.has(f.code + f.message) && seen.add(f.code + f.message));
}

export function hasBlocking(flags: Flag[]) {
  return flags.some((f) => f.severity === "error");
}
