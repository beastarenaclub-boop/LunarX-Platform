CREATE TYPE "public"."demo_nudge_kind" AS ENUM('impression', 'click', 'conversion');--> statement-breakpoint
CREATE TYPE "public"."demo_nudge_trigger" AS ENUM('rounds', 'bigwin', 'lowbalance');--> statement-breakpoint
CREATE TABLE "upi_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"upi_id" text NOT NULL,
	"qr_object_key" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demo_nudge_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"session_ref" text,
	"kind" "demo_nudge_kind" NOT NULL,
	"trigger" "demo_nudge_trigger" NOT NULL,
	"language" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "upi_accounts" ADD CONSTRAINT "upi_accounts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_nudge_events" ADD CONSTRAINT "demo_nudge_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "upi_accounts_active_idx" ON "upi_accounts" USING btree ("active");--> statement-breakpoint
CREATE INDEX "upi_accounts_sort_order_idx" ON "upi_accounts" USING btree ("sort_order");--> statement-breakpoint
CREATE INDEX "demo_nudge_events_kind_trigger_idx" ON "demo_nudge_events" USING btree ("kind","trigger");--> statement-breakpoint
CREATE INDEX "demo_nudge_events_session_ref_idx" ON "demo_nudge_events" USING btree ("session_ref");--> statement-breakpoint
CREATE INDEX "demo_nudge_events_created_at_idx" ON "demo_nudge_events" USING btree ("created_at");