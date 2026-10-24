CREATE TYPE "public"."suggestion_status" AS ENUM('pending', 'applied', 'dismissed', 'stale');--> statement-breakpoint
CREATE TABLE "ai_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid NOT NULL,
	"target" jsonb NOT NULL,
	"instruction" text NOT NULL,
	"original_text" text NOT NULL,
	"suggested_text" text NOT NULL,
	"rationale" text DEFAULT '' NOT NULL,
	"model_id" text NOT NULL,
	"cost_usd" numeric(10, 4),
	"status" "suggestion_status" DEFAULT 'pending' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "spend_days" (
	"day" date PRIMARY KEY NOT NULL,
	"spent_usd" numeric(10, 4) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "acknowledged_warnings" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "spent_usd" numeric(10, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_suggestions_lesson" ON "ai_suggestions" USING btree ("lesson_id");--> statement-breakpoint
-- Existing units start from what their runs have already spent.
UPDATE "units" SET "spent_usd" = COALESCE((SELECT SUM("spent_usd") FROM "generation_runs" WHERE "generation_runs"."unit_id" = "units"."id"), 0);
