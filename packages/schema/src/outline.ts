import { extractCodes, isKnownCode } from "./standards";

export type FlagSeverity = "error" | "warning" | "info";

/**
 * Something the content expert must see before generation. `error` flags
 * block generation until resolved; the importer never silently picks a side.
 */
export type Flag = {
  code: string;
  severity: FlagSeverity;
  message: string;
  field?: string;
  /** Choices offered to the expert, when the flag is a decision. */
  options?: string[];
};

export type OutlineRow = {
  lessonNumber: number;
  filename: string;
  lessonGroup: string;
  lessonType: string;
  days: number | null;
  textDependentQuestion: string;
  description: string;
  textSet: string;
  homework: string;
  focusStandards: string[];
  supportingStandards: string[];
  mediaLiteracyCodes: string[];
  performanceTaskSkill: string;
  foundationalSkills: string;
  vocabulary: string[];
  eldStandards: string[];
  /** Reviewer notes found in cells; generation uses them only once the expert confirms. */
  reviewerNotes: string[];
  raw: Record<string, string>;
  flags: Flag[];
};

export type ParsedOutline = {
  title: string;
  grade: number | null;
  unitNumber: number | null;
  anchorText: string | null;
  rows: OutlineRow[];
  unitFlags: Flag[];
};

// Header text in the sheet → field. Matching is case- and punctuation-insensitive.
const COLUMNS: Record<string, keyof OutlineRow> = {
  filename: "filename",
  lesson: "lessonGroup",
  "lesson #": "lessonNumber",
  "type of lesson": "lessonType",
  days: "days",
  "text dependent question tied to the eq": "textDependentQuestion",
  "lesson description": "description",
  "text set choice": "textSet",
  homework: "homework",
  "focus standards (assessed)": "focusStandards",
  "additional supported ca ela standards": "supportingStandards",
  "ca media literacy standards": "mediaLiteracyCodes",
  "skill or content that will be needed for performance task": "performanceTaskSkill",
  "foundational skills focus": "foundationalSkills",
  vocabulary: "vocabulary",
  "designated eld standards": "eldStandards",
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

const FILENAME = /^L(\d+)_ELA_TE_G(\d+)_U(\d+)_CA_Core$/;
const TITLE = /G\s*(\d+)\s*,\s*U\s*(\d+)\s*:\s*(.+?)(?:\s+by\s+(.+?))?(?:\n|$)/i;

/** Notes addressed to a human writer or reviewer rather than lesson content. */
const NOTE_PATTERNS: { re: RegExp; kind: "constraint" | "excerpt" }[] = [
  { re: /WRITER (?:MUST|NEEDS TO|SHOULD)[^.\n]*/gi, kind: "excerpt" },
  { re: /\(?Writer should[^)\n]*\)?/gi, kind: "excerpt" },
  { re: /Cap at [^\n]*/gi, kind: "constraint" },
  { re: /Replace repeated[^\n]*/gi, kind: "constraint" },
];

/** Cell text that reads like an instruction to a model. Shown to the expert, never obeyed. */
const INJECTION = /\b(ignore (?:all |the )?(?:previous|above) instructions|system prompt|you are (?:an?|the) (?:ai|assistant|model))\b/i;

export function parseOutline(grid: string[][]): ParsedOutline {
  const unitFlags: Flag[] = [];
  const headerIdx = grid.findIndex((r) => r.some((c) => norm(c) === "lesson #"));
  if (headerIdx < 0) throw new OutlineError('Could not find a header row with a "Lesson #" column.');

  const header = grid[headerIdx]!.map(norm);
  const colOf = new Map<keyof OutlineRow, number>();
  header.forEach((h, i) => {
    const field = COLUMNS[h];
    if (field && !colOf.has(field)) colOf.set(field, i);
  });
  for (const [h, field] of Object.entries(COLUMNS)) {
    if (!colOf.has(field)) unitFlags.push({ code: "missing_column", severity: "warning", message: `Column "${h}" was not found.` });
  }

  const titleCell = grid.slice(0, headerIdx).flat().find((c) => TITLE.test(c)) ?? "";
  const t = TITLE.exec(titleCell);
  const title = titleCell.split("\n")[0]?.trim() || "Untitled unit";
  const grade = t ? Number(t[1]) : null;
  const titleUnit = t ? Number(t[2]) : null;
  const anchorText = t ? t[3]!.trim() : null;

  const rows: OutlineRow[] = [];
  for (const r of grid.slice(headerIdx + 1)) {
    const get = (f: keyof OutlineRow) => (colOf.has(f) ? (r[colOf.get(f)!] ?? "").trim() : "");
    // "Lesson 12" or "12". Section headings ("Across Lessons 4-19, ...") and blank rows are skipped.
    const num = /^(?:lesson\s*)?(\d+)$/i.exec(get("lessonNumber").replace(/\u00a0/g, " ").trim());
    if (!num) continue;
    const raw: Record<string, string> = {};
    grid[headerIdx]!.forEach((h, i) => {
      if (h.trim()) raw[h.trim()] = r[i] ?? "";
    });
    const allText = Object.values(raw).join("\n");
    rows.push({
      lessonNumber: Number(num[1]),
      filename: get("filename"),
      lessonGroup: get("lessonGroup"),
      lessonType: get("lessonType"),
      days: get("days") ? Number(get("days")) : null,
      textDependentQuestion: get("textDependentQuestion"),
      description: get("description"),
      textSet: get("textSet"),
      homework: get("homework"),
      focusStandards: extractCodes(get("focusStandards")),
      supportingStandards: extractCodes(get("supportingStandards")),
      mediaLiteracyCodes: splitList(get("mediaLiteracyCodes")),
      performanceTaskSkill: get("performanceTaskSkill"),
      foundationalSkills: get("foundationalSkills"),
      vocabulary: parseVocabulary(get("vocabulary")),
      eldStandards: extractCodes(get("eldStandards")),
      reviewerNotes: NOTE_PATTERNS.flatMap(({ re }) => allText.match(re) ?? []).map((s) => s.trim()),
      raw,
      flags: [],
    });
  }
  if (rows.length === 0) throw new OutlineError("No lesson rows found under the header row.");

  checkRows(rows, unitFlags, titleUnit, grade);

  return { title, grade, unitNumber: titleUnit, anchorText, rows, unitFlags };
}

function checkRows(rows: OutlineRow[], unitFlags: Flag[], titleUnit: number | null, grade: number | null) {
  // Unit number: title vs filenames.
  const fileUnits = new Set(rows.map((r) => FILENAME.exec(r.filename)?.[3]).filter(Boolean).map(Number));
  if (titleUnit !== null && fileUnits.size > 0 && !(fileUnits.size === 1 && fileUnits.has(titleUnit))) {
    unitFlags.push({
      code: "unit_number_conflict",
      severity: "error",
      field: "unitNumber",
      message: `The title says Unit ${titleUnit}, but filenames say U${[...fileUnits].join(", U")}.`,
      options: [...new Set([titleUnit, ...fileUnits])].map((u) => `Unit ${u}`),
    });
  }

  const seen = new Map<number, number>();
  for (const r of rows) seen.set(r.lessonNumber, (seen.get(r.lessonNumber) ?? 0) + 1);

  rows.forEach((r, i) => {
    const f = r.flags;
    if ((seen.get(r.lessonNumber) ?? 0) > 1)
      f.push({ code: "duplicate_lesson", severity: "error", field: "lessonNumber", message: `Lesson ${r.lessonNumber} appears more than once.` });

    const m = FILENAME.exec(r.filename);
    if (!r.filename) f.push({ code: "filename_missing", severity: "warning", field: "filename", message: "No filename. Matched by lesson number." });
    else if (!m || Number(m[1]) !== r.lessonNumber)
      f.push({ code: "filename_malformed", severity: "warning", field: "filename", message: `Filename "${r.filename}" does not match lesson ${r.lessonNumber}. Matched by lesson number.` });
    else if (grade !== null && Number(m[2]) !== grade)
      f.push({ code: "filename_grade", severity: "warning", field: "filename", message: `Filename says grade ${m[2]}, the title says grade ${grade}.` });

    if (/double/i.test(r.lessonType) && r.days === 1)
      f.push({
        code: "double_lesson_days",
        severity: "error",
        field: "days",
        message: `Marked "${r.lessonType}", but Days is 1.`,
        options: ["One 50-minute lesson", "Two-day lesson (100 minutes)"],
      });

    if (r.eldStandards.length === 0)
      f.push({ code: "missing_eld", severity: "warning", field: "eldStandards", message: "No Designated ELD codes. No ELD support block will be generated." });
    if (r.focusStandards.length === 0)
      f.push({ code: "missing_focus_standards", severity: "error", field: "focusStandards", message: "No focus standards." });

    const unknown = [...new Set([...r.focusStandards, ...r.supportingStandards, ...r.eldStandards])].filter((c) => !isKnownCode(c));
    if (unknown.length)
      f.push({ code: "unknown_standard", severity: "warning", message: `Not in the grade 6 CA standards list: ${unknown.join(", ")}.` });
    if (r.mediaLiteracyCodes.length)
      f.push({
        code: "unrecognized_media_literacy",
        severity: "warning",
        field: "mediaLiteracyCodes",
        message: `Media literacy codes ${r.mediaLiteracyCodes.join(", ")} are from an unidentified framework. Stored as given.`,
      });

    // Homework normally previews the next lesson's reading. Flag a break in that chain.
    const next = rows[i + 1];
    const hwCh = chapters(r.homework);
    const nextCh = next ? chapters(next.description.slice(0, 80)) : [];
    if (hwCh.length && nextCh.length && !nextCh.some((c) => hwCh.includes(c)))
      f.push({
        code: "homework_continuity",
        severity: "warning",
        field: "homework",
        message: `Homework assigns Ch. ${hwCh.join(", ")}, but lesson ${next!.lessonNumber} focuses on Ch. ${nextCh.join(", ")}.`,
      });

    for (const note of r.reviewerNotes)
      f.push({ code: /writer/i.test(note) ? "excerpt_needs_selection" : "reviewer_note", severity: "info", message: note });

    const repeated = repeatedLines(Object.values(r.raw));
    if (repeated.length)
      f.push({ code: "repeated_text", severity: "info", message: `Repeated text in the row: "${repeated[0]!.slice(0, 80)}"` });

    if (INJECTION.test(Object.values(r.raw).join("\n")))
      f.push({ code: "instruction_like_text", severity: "warning", message: "A cell reads like an instruction to an AI. It is shown here and never sent as an instruction." });
  });
}

export class OutlineError extends Error {}

function chapters(text: string): number[] {
  return [...text.matchAll(/\bCh(?:apter|\.)?\s*(\d+)/gi)].map((m) => Number(m[1]));
}

function splitList(cell: string): string[] {
  return cell
    .split(/[,;\n•]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** "• memento (140)" → "memento"; drops the "vocabulary:" label lines and page refs. */
export function parseVocabulary(cell: string): string[] {
  return splitList(cell)
    .map((s) => s.replace(/\(\s*\d+\s*\)/g, "").replace(/^[◦o-]\s*/, "").trim())
    .filter((s) => s && !/:$/.test(s) && s.split(/\s+/).length <= 4);
}

function repeatedLines(cells: string[]): string[] {
  const out: string[] = [];
  for (const cell of cells) {
    const seen = new Set<string>();
    for (const line of cell.split(/\n|(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 30)) {
      if (seen.has(line)) out.push(line);
      seen.add(line);
    }
  }
  return out;
}

/** Errors that must be resolved before generation can start. */
export function blockingFlags(o: ParsedOutline): Flag[] {
  return [...o.unitFlags, ...o.rows.flatMap((r) => r.flags)].filter((f) => f.severity === "error");
}
