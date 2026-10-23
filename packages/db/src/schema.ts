import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => "bytea",
  toDriver: (value) => Buffer.from(value),
  fromDriver: (value) => new Uint8Array(value),
});

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// People and roles
// ---------------------------------------------------------------------------

/** expert: imports outlines and runs generation. reviewer: edits. approver: edits and finalizes. */
export const roleEnum = pgEnum("role", ["expert", "reviewer", "approver", "admin"]);

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: roleEnum("role").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Standards: codes and official links only. Standard text is never stored
// paraphrased; the UI links to (or quotes verbatim) the official source.
// ---------------------------------------------------------------------------

export const frameworkEnum = pgEnum("framework", ["ca_ccss_ela", "ca_eld", "media_literacy"]);

export const standards = pgTable("standards", {
  code: text("code").primaryKey(),
  framework: frameworkEnum("framework").notNull(),
  grade: smallint("grade"),
  strand: text("strand"),
  officialUrl: text("official_url"),
  /** California-specific addition to the CCSS. */
  caAddition: boolean("ca_addition").notNull().default(false),
});

// ---------------------------------------------------------------------------
// Units and their imported outline rows
// ---------------------------------------------------------------------------

export const unitStatusEnum = pgEnum("unit_status", [
  "needs_review", // imported; expert must resolve flags
  "ready", // flags resolved; can generate
  "generating",
  "in_review",
  "approved",
]);

export const units = pgTable("units", {
  id: id(),
  title: text("title").notNull(),
  grade: smallint("grade"),
  unitNumber: smallint("unit_number"),
  anchorText: text("anchor_text"),
  /** "upload" (xlsx/csv) or "google_sheet" (sheet id only). */
  sourceKind: text("source_kind").notNull(),
  sourceRef: text("source_ref").notNull(),
  status: unitStatusEnum("status").notNull().default("needs_review"),
  /** Unit-level flags, e.g. title vs filename unit mismatch. */
  flags: jsonb("flags").$type<Flag[]>().notNull().default([]),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
});

export type FlagSeverity = "error" | "warning" | "info";
export type Flag = {
  code: string;
  severity: FlagSeverity;
  message: string;
  field?: string;
  /** Set when an expert accepts or overrides the flag. */
  resolution?: { by: string; at: string; note?: string };
};

export const outlineRows = pgTable(
  "outline_rows",
  {
    id: id(),
    unitId: uuid("unit_id").notNull().references(() => units.id, { onDelete: "cascade" }),
    lessonNumber: integer("lesson_number").notNull(),
    filename: text("filename"),
    lessonGroup: text("lesson_group"), // Spark, Investigation 1, ...
    lessonType: text("lesson_type"), // Core Reading, Core Writing, ...
    days: numeric("days"),
    textDependentQuestion: text("text_dependent_question"),
    description: text("description"),
    textSet: text("text_set"),
    homework: text("homework"),
    focusStandards: text("focus_standards").array().notNull().default(sql`'{}'::text[]`),
    supportingStandards: text("supporting_standards").array().notNull().default(sql`'{}'::text[]`),
    mediaLiteracyCodes: text("media_literacy_codes").array().notNull().default(sql`'{}'::text[]`),
    performanceTaskSkill: text("performance_task_skill"),
    foundationalSkills: text("foundational_skills"),
    vocabulary: text("vocabulary").array().notNull().default(sql`'{}'::text[]`),
    eldStandards: text("eld_standards").array().notNull().default(sql`'{}'::text[]`),
    /** The row exactly as imported, for audit. Untrusted: never sent to the model as instructions. */
    raw: jsonb("raw").$type<Record<string, string>>().notNull(),
    flags: jsonb("flags").$type<Flag[]>().notNull().default([]),
    /** Reviewer notes the expert explicitly confirmed as generation constraints. */
    confirmedConstraints: jsonb("confirmed_constraints").$type<string[]>().notNull().default([]),
  },
  (t) => [uniqueIndex("outline_rows_unit_lesson").on(t.unitId, t.lessonNumber)],
);

// ---------------------------------------------------------------------------
// Prompts (versioned, never edited in place)
// ---------------------------------------------------------------------------

export const promptVersions = pgTable("prompt_versions", {
  id: id(),
  version: integer("version").notNull().unique(),
  systemPrompt: text("system_prompt").notNull(),
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Lessons, versions and provenance
// ---------------------------------------------------------------------------

export const lessonStatusEnum = pgEnum("lesson_status", [
  "pending",
  "generating",
  "flagged", // generated output failed validation or generation failed
  "in_review",
  "approved",
]);

export const lessons = pgTable(
  "lessons",
  {
    id: id(),
    unitId: uuid("unit_id").notNull().references(() => units.id, { onDelete: "cascade" }),
    outlineRowId: uuid("outline_row_id").notNull().references(() => outlineRows.id, { onDelete: "cascade" }),
    status: lessonStatusEnum("status").notNull().default("pending"),
    /** Latest generated version (the editor's starting point). */
    generatedVersionId: uuid("generated_version_id"),
    /** Live collaborative document (Yjs update). Never the approved record. */
    collabState: bytea("collab_state"),
    /** Random room id for the collaboration server; not derived from the lesson id. */
    collabRoom: text("collab_room")
      .notNull()
      .unique()
      .$defaultFn(() => randomBytes(18).toString("hex")),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("lessons_outline_row").on(t.outlineRowId), index("lessons_unit").on(t.unitId)],
);

export const versionSourceEnum = pgEnum("version_source", ["ai", "human"]);

export const lessonVersions = pgTable(
  "lesson_versions",
  {
    id: id(),
    lessonId: uuid("lesson_id").notNull().references(() => lessons.id, { onDelete: "cascade" }),
    source: versionSourceEnum("source").notNull(),
    content: jsonb("content").notNull(),
    // Provenance for AI-generated versions
    promptVersionId: uuid("prompt_version_id").references(() => promptVersions.id),
    modelId: text("model_id"),
    generationJobId: uuid("generation_job_id"),
    validation: jsonb("validation").$type<Flag[]>().notNull().default([]),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("lesson_versions_lesson").on(t.lessonId)],
);

// ---------------------------------------------------------------------------
// Generation runs and jobs
// ---------------------------------------------------------------------------

export const runStatusEnum = pgEnum("run_status", ["running", "completed", "stopped_at_cap", "cancelled"]);

export const generationRuns = pgTable("generation_runs", {
  id: id(),
  unitId: uuid("unit_id").notNull().references(() => units.id, { onDelete: "cascade" }),
  promptVersionId: uuid("prompt_version_id").notNull().references(() => promptVersions.id),
  modelId: text("model_id").notNull(),
  capUsd: numeric("cap_usd", { precision: 10, scale: 4 }).notNull(),
  spentUsd: numeric("spent_usd", { precision: 10, scale: 4 }).notNull().default("0"),
  status: runStatusEnum("status").notNull().default("running"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
});

export const jobStatusEnum = pgEnum("job_status", ["queued", "running", "succeeded", "flagged", "failed", "skipped"]);

export const generationJobs = pgTable(
  "generation_jobs",
  {
    id: id(),
    runId: uuid("run_id").notNull().references(() => generationRuns.id, { onDelete: "cascade" }),
    lessonId: uuid("lesson_id").notNull().references(() => lessons.id, { onDelete: "cascade" }),
    /** unit:lesson:promptVersion. Re-queuing the same key never duplicates work. */
    idempotencyKey: text("idempotency_key").notNull().unique(),
    status: jobStatusEnum("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 4 }),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("generation_jobs_run").on(t.runId)],
);

// ---------------------------------------------------------------------------
// Approval: a frozen snapshot plus its hash. Any later edit revokes it.
// ---------------------------------------------------------------------------

export const approvals = pgTable(
  "approvals",
  {
    id: id(),
    lessonId: uuid("lesson_id").notNull().references(() => lessons.id, { onDelete: "cascade" }),
    approverId: uuid("approver_id").notNull().references(() => users.id),
    contentHash: text("content_hash").notNull(), // sha256 of the canonical snapshot JSON
    snapshot: jsonb("snapshot").notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedReason: text("revoked_reason"),
  },
  (t) => [index("approvals_lesson").on(t.lessonId)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    unitId: uuid("unit_id").references(() => units.id, { onDelete: "cascade" }),
    lessonId: uuid("lesson_id").references(() => lessons.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id),
    action: text("action").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_lesson").on(t.lessonId), index("audit_log_unit").on(t.unitId)],
);
