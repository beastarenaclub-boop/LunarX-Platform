CREATE TYPE "public"."free_bet_source" AS ENUM('admin', 'rain');--> statement-breakpoint
CREATE TABLE "free_bet_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"game_code" text DEFAULT 'lunar' NOT NULL,
	"amount_paise" bigint NOT NULL,
	"total_count" integer NOT NULL,
	"remaining_count" integer NOT NULL,
	"source" "free_bet_source" DEFAULT 'admin' NOT NULL,
	"granted_by" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rain_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"rain_id" text NOT NULL,
	"user_id" text NOT NULL,
	"grant_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rain_events" (
	"id" text PRIMARY KEY NOT NULL,
	"game_code" text DEFAULT 'lunar' NOT NULL,
	"amount_paise" bigint NOT NULL,
	"bets_per_claim" integer DEFAULT 1 NOT NULL,
	"max_claims" integer NOT NULL,
	"claimed_count" integer DEFAULT 0 NOT NULL,
	"message" text,
	"created_by" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "wallets_user_currency_idx";--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "scope" text DEFAULT 'lunar' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD COLUMN "game" text DEFAULT 'lunar' NOT NULL;--> statement-breakpoint
ALTER TABLE "free_bet_grants" ADD CONSTRAINT "free_bet_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "free_bet_grants" ADD CONSTRAINT "free_bet_grants_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rain_claims" ADD CONSTRAINT "rain_claims_rain_id_rain_events_id_fk" FOREIGN KEY ("rain_id") REFERENCES "public"."rain_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rain_claims" ADD CONSTRAINT "rain_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rain_claims" ADD CONSTRAINT "rain_claims_grant_id_free_bet_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."free_bet_grants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rain_events" ADD CONSTRAINT "rain_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "free_bet_grants_user_idx" ON "free_bet_grants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "free_bet_grants_created_idx" ON "free_bet_grants" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rain_claims_rain_user_idx" ON "rain_claims" USING btree ("rain_id","user_id");--> statement-breakpoint
CREATE INDEX "rain_claims_user_idx" ON "rain_claims" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "rain_events_created_idx" ON "rain_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wallets_user_currency_scope_idx" ON "wallets" USING btree ("user_id","currency","scope");