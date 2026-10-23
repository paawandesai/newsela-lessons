CREATE TYPE "public"."framework" AS ENUM('ca_ccss_ela', 'ca_eld', 'media_literacy');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'flagged', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."lesson_status" AS ENUM('pending', 'generating', 'flagged', 'in_review', 'approved');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('expert', 'reviewer', 'approver', 'admin');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('running', 'completed', 'stopped_at_cap', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."unit_status" AS ENUM('needs_review', 'ready', 'generating', 'in_review', 'approved');--> statement-breakpoint
CREATE TYPE "public"."version_source" AS ENUM('ai', 'human');--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid NOT NULL,
	"approver_id" uuid NOT NULL,
	"content_hash" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_id" uuid,
	"lesson_id" uuid,
	"actor_id" uuid,
	"action" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" numeric(10, 4),
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generation_jobs_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "generation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_id" uuid NOT NULL,
	"prompt_version_id" uuid NOT NULL,
	"model_id" text NOT NULL,
	"cap_usd" numeric(10, 4) NOT NULL,
	"spent_usd" numeric(10, 4) DEFAULT '0' NOT NULL,
	"status" "run_status" DEFAULT 'running' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lesson_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid NOT NULL,
	"source" "version_source" NOT NULL,
	"content" jsonb NOT NULL,
	"prompt_version_id" uuid,
	"model_id" text,
	"generation_job_id" uuid,
	"validation" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lessons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_id" uuid NOT NULL,
	"outline_row_id" uuid NOT NULL,
	"status" "lesson_status" DEFAULT 'pending' NOT NULL,
	"generated_version_id" uuid,
	"collab_state" "bytea",
	"collab_room" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lessons_collab_room_unique" UNIQUE("collab_room")
);
--> statement-breakpoint
CREATE TABLE "outline_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_id" uuid NOT NULL,
	"lesson_number" integer NOT NULL,
	"filename" text,
	"lesson_group" text,
	"lesson_type" text,
	"days" numeric,
	"text_dependent_question" text,
	"description" text,
	"text_set" text,
	"homework" text,
	"focus_standards" text[] DEFAULT '{}'::text[] NOT NULL,
	"supporting_standards" text[] DEFAULT '{}'::text[] NOT NULL,
	"media_literacy_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"performance_task_skill" text,
	"foundational_skills" text,
	"vocabulary" text[] DEFAULT '{}'::text[] NOT NULL,
	"eld_standards" text[] DEFAULT '{}'::text[] NOT NULL,
	"raw" jsonb NOT NULL,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confirmed_constraints" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"system_prompt" text NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prompt_versions_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "standards" (
	"code" text PRIMARY KEY NOT NULL,
	"framework" "framework" NOT NULL,
	"grade" smallint,
	"strand" text,
	"official_url" text,
	"ca_addition" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"grade" smallint,
	"unit_number" smallint,
	"anchor_text" text,
	"source_kind" text NOT NULL,
	"source_ref" text NOT NULL,
	"status" "unit_status" DEFAULT 'needs_review' NOT NULL,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "role" NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_run_id_generation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."generation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_prompt_version_id_prompt_versions_id_fk" FOREIGN KEY ("prompt_version_id") REFERENCES "public"."prompt_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_versions" ADD CONSTRAINT "lesson_versions_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_versions" ADD CONSTRAINT "lesson_versions_prompt_version_id_prompt_versions_id_fk" FOREIGN KEY ("prompt_version_id") REFERENCES "public"."prompt_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_versions" ADD CONSTRAINT "lesson_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_outline_row_id_outline_rows_id_fk" FOREIGN KEY ("outline_row_id") REFERENCES "public"."outline_rows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outline_rows" ADD CONSTRAINT "outline_rows_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_lesson" ON "approvals" USING btree ("lesson_id");--> statement-breakpoint
CREATE INDEX "audit_log_lesson" ON "audit_log" USING btree ("lesson_id");--> statement-breakpoint
CREATE INDEX "audit_log_unit" ON "audit_log" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "generation_jobs_run" ON "generation_jobs" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "lesson_versions_lesson" ON "lesson_versions" USING btree ("lesson_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lessons_outline_row" ON "lessons" USING btree ("outline_row_id");--> statement-breakpoint
CREATE INDEX "lessons_unit" ON "lessons" USING btree ("unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "outline_rows_unit_lesson" ON "outline_rows" USING btree ("unit_id","lesson_number");