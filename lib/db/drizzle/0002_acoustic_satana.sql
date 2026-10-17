CREATE TYPE "public"."agent_payout_status" AS ENUM('pending', 'approved', 'rejected', 'paid');--> statement-breakpoint
CREATE TYPE "public"."commission_status" AS ENUM('pending', 'settled');--> statement-breakpoint
CREATE TYPE "public"."recon_status" AS ENUM('matched', 'mismatch_amount', 'missing_in_gateway', 'missing_in_ledger', 'status_mismatch');--> statement-breakpoint
ALTER TYPE "public"."payment_request_status" ADD VALUE 'gateway_pending';--> statement-breakpoint
CREATE TABLE "agent_payouts" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"upi_id" text NOT NULL,
	"status" "agent_payout_status" DEFAULT 'pending' NOT NULL,
	"rejection_reason" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"commission_rate" integer DEFAULT 10 NOT NULL,
	"upi_id" text,
	"parent_agent_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commissions" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"player_id" text NOT NULL,
	"period_date" timestamp with time zone NOT NULL,
	"gross_stake" bigint DEFAULT 0 NOT NULL,
	"gross_payout" bigint DEFAULT 0 NOT NULL,
	"net_revenue" bigint DEFAULT 0 NOT NULL,
	"commission_rate" integer NOT NULL,
	"commission_amount" bigint DEFAULT 0 NOT NULL,
	"status" "commission_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"run_date" timestamp with time zone NOT NULL,
	"gateway_order_id" text,
	"ledger_entry_id" text,
	"payment_request_id" text,
	"withdrawal_id" text,
	"direction" text NOT NULL,
	"gateway_amount" bigint,
	"ledger_amount" bigint,
	"status" "recon_status" NOT NULL,
	"details" jsonb,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_requests" ADD COLUMN "gateway_order_id" text;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD COLUMN "gateway_status" text;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD COLUMN "gateway_raw" text;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD COLUMN "kind" text DEFAULT 'player_withdrawal' NOT NULL;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD COLUMN "gateway_payout_id" text;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD COLUMN "gateway_status" text;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD COLUMN "utr" text;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD COLUMN "manual_settlement" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_payouts" ADD CONSTRAINT "agent_payouts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_payouts" ADD CONSTRAINT "agent_payouts_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_player_id_users_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_payouts_agent_id_idx" ON "agent_payouts" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_payouts_status_idx" ON "agent_payouts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_payouts_requested_at_idx" ON "agent_payouts" USING btree ("requested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_user_id_idx" ON "agents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agents_status_idx" ON "agents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "commissions_agent_id_idx" ON "commissions" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "commissions_player_id_idx" ON "commissions" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "commissions_period_date_idx" ON "commissions" USING btree ("period_date");--> statement-breakpoint
CREATE INDEX "commissions_status_idx" ON "commissions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "commissions_agent_player_date_idx" ON "commissions" USING btree ("agent_id","player_id","period_date");--> statement-breakpoint
CREATE INDEX "recon_run_date_idx" ON "reconciliation_entries" USING btree ("run_date");--> statement-breakpoint
CREATE INDEX "recon_status_idx" ON "reconciliation_entries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "recon_gateway_order_idx" ON "reconciliation_entries" USING btree ("gateway_order_id");--> statement-breakpoint
CREATE INDEX "recon_created_at_idx" ON "reconciliation_entries" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_referral_code_idx" ON "users" USING btree ("referral_code") WHERE "users"."referral_code" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "users_referred_by_idx" ON "users" USING btree ("referred_by");--> statement-breakpoint
CREATE INDEX "withdrawals_kind_idx" ON "withdrawals" USING btree ("kind");