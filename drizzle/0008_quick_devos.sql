CREATE TABLE "issue_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"action_id" varchar NOT NULL,
	"descriptor_code" varchar NOT NULL,
	"descriptor_name" varchar,
	"short_desc" varchar,
	"updated_at" timestamp with time zone,
	"action_by" varchar,
	"actor_details_name" varchar,
	"resolution_id" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_actors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"actor_id" varchar NOT NULL,
	"actor_type" varchar NOT NULL,
	"org_name" varchar,
	"person_name" varchar,
	"contact_phone" varchar,
	"contact_email" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_refs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"ref_id" varchar NOT NULL,
	"ref_type" varchar NOT NULL,
	"quantity_count" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" varchar NOT NULL,
	"transaction_id" varchar NOT NULL,
	"order_id" varchar NOT NULL,
	"bpp_id" varchar,
	"bpp_uri" varchar,
	"category_code" varchar NOT NULL,
	"descriptor_code" varchar NOT NULL,
	"status" varchar DEFAULT 'OPEN' NOT NULL,
	"level" varchar DEFAULT 'ISSUE' NOT NULL,
	"short_desc" varchar,
	"long_desc" varchar,
	"additional_desc_url" varchar,
	"additional_desc_content_type" varchar,
	"respondent_ids" varchar[],
	"source_id" varchar,
	"complainant_id" varchar,
	"expected_response_duration" varchar,
	"expected_resolution_duration" varchar,
	"last_action_id" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "issue_actions" ADD CONSTRAINT "issue_actions_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_actors" ADD CONSTRAINT "issue_actors_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_refs" ADD CONSTRAINT "issue_refs_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "issue_actions_issue_action_idx" ON "issue_actions" USING btree ("issue_id","action_id");--> statement-breakpoint
CREATE INDEX "issue_actions_issue_id_idx" ON "issue_actions" USING btree ("issue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_actors_issue_actor_idx" ON "issue_actors" USING btree ("issue_id","actor_id");--> statement-breakpoint
CREATE INDEX "issue_actors_issue_id_idx" ON "issue_actors" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "issue_refs_issue_id_idx" ON "issue_refs" USING btree ("issue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "issues_issue_id_idx" ON "issues" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "issues_order_id_idx" ON "issues" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "issues_transaction_id_idx" ON "issues" USING btree ("transaction_id");