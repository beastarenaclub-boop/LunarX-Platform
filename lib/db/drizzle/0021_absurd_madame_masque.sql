CREATE TYPE "public"."bonus_event_type" AS ENUM('signup_granted', 'signup_blocked_ip', 'signup_blocked_email', 'deposit_bonus_granted', 'referral_signed_up', 'referral_qualified', 'bonus_bet_placed', 'bonus_win_credited', 'bonus_converted_to_cash', 'bonus_revoked', 'settings_updated');--> statement-breakpoint
CREATE TYPE "public"."bonus_ledger_type" AS ENUM('signup', 'deposit_tier', 'referral', 'bet', 'win', 'conversion_out', 'conversion_in', 'revoke', 'adjust');--> statement-breakpoint
CREATE TYPE "public"."referral_status" AS ENUM('signed_up', 'qualified');--> statement-breakpoint
CREATE TABLE "bonus_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"type" "bonus_event_type" NOT NULL,
	"amount" bigint DEFAULT 0 NOT NULL,
	"ip" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bonus_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" "bonus_ledger_type" NOT NULL,
	"amount" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"ref_type" text,
	"ref_id" text,
	"memo" text,
	"metadata" jsonb,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bonus_wagering" (
	"user_id" text PRIMARY KEY NOT NULL,
	"total_issued" bigint DEFAULT 0 NOT NULL,
	"required_wager" bigint DEFAULT 0 NOT NULL,
	"wagered_so_far" bigint DEFAULT 0 NOT NULL,
	"last_converted_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promotion_settings" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"signup_bonus_paise" bigint DEFAULT 100000 NOT NULL,
	"deposit_tiers" jsonb NOT NULL,
	"referrer_reward_paise" bigint DEFAULT 50000 NOT NULL,
	"referrer_min_deposit_paise" bigint DEFAULT 500000 NOT NULL,
	"wagering_multiplier" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" text PRIMARY KEY NOT NULL,
	"referrer_id" text NOT NULL,
	"referee_id" text NOT NULL,
	"referral_code" text NOT NULL,
	"status" "referral_status" DEFAULT 'signed_up' NOT NULL,
	"qualifying_deposit_id" text,
	"reward_ledger_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"qualified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "signup_bonus_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"ip" text,
	"email_normalized" text NOT NULL,
	"granted" boolean NOT NULL,
	"blocked_reason" text,
	"amount" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bonus_events" ADD CONSTRAINT "bonus_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_ledger" ADD CONSTRAINT "bonus_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_ledger" ADD CONSTRAINT "bonus_ledger_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_wagering" ADD CONSTRAINT "bonus_wagering_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_settings" ADD CONSTRAINT "promotion_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_id_users_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referee_id_users_id_fk" FOREIGN KEY ("referee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signup_bonus_claims" ADD CONSTRAINT "signup_bonus_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bonus_events_type_idx" ON "bonus_events" USING btree ("type");--> statement-breakpoint
CREATE INDEX "bonus_events_created_at_idx" ON "bonus_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "bonus_events_user_idx" ON "bonus_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "bonus_ledger_user_idx" ON "bonus_ledger" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "bonus_ledger_type_idx" ON "bonus_ledger" USING btree ("type");--> statement-breakpoint
CREATE INDEX "bonus_ledger_created_at_idx" ON "bonus_ledger" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bonus_ledger_credit_idem_idx" ON "bonus_ledger" USING btree ("ref_type","ref_id","type") WHERE "bonus_ledger"."type" IN ('signup','deposit_tier','referral') AND "bonus_ledger"."ref_type" IS NOT NULL AND "bonus_ledger"."ref_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_referee_idx" ON "referrals" USING btree ("referee_id");--> statement-breakpoint
CREATE INDEX "referrals_referrer_idx" ON "referrals" USING btree ("referrer_id");--> statement-breakpoint
CREATE INDEX "referrals_status_idx" ON "referrals" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "signup_bonus_claims_user_idx" ON "signup_bonus_claims" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signup_bonus_claims_ip_granted_idx" ON "signup_bonus_claims" USING btree ("ip") WHERE "signup_bonus_claims"."granted" = true AND "signup_bonus_claims"."ip" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "signup_bonus_claims_email_granted_idx" ON "signup_bonus_claims" USING btree ("email_normalized") WHERE "signup_bonus_claims"."granted" = true;