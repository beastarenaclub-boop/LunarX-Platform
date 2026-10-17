CREATE TYPE "public"."payment_method" AS ENUM('manual', 'auto');--> statement-breakpoint
CREATE TYPE "public"."payment_request_kind" AS ENUM('deposit', 'withdraw');--> statement-breakpoint
CREATE TYPE "public"."payment_request_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."withdrawal_status" AS ENUM('pending', 'approved', 'rejected', 'paid', 'failed');--> statement-breakpoint
CREATE TYPE "public"."fraud_severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."wallet_status_value" AS ENUM('active', 'frozen');--> statement-breakpoint
CREATE TYPE "public"."app_log_level" AS ENUM('info', 'warn', 'error');--> statement-breakpoint
CREATE TYPE "public"."ticket_category" AS ENUM('deposit', 'withdrawal', 'kyc', 'game', 'account', 'other');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('open', 'awaiting_reply', 'resolved', 'closed');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('kyc_approved', 'kyc_rejected', 'deposit_credited', 'deposit_approved', 'deposit_rejected', 'withdrawal_approved', 'withdrawal_rejected', 'ticket_reply', 'bonus_issued', 'custom');--> statement-breakpoint
CREATE TYPE "public"."banner_type" AS ENUM('info', 'warning', 'promo');--> statement-breakpoint
CREATE TABLE "deposit_settings" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"manual_enabled" boolean DEFAULT true NOT NULL,
	"auto_enabled" boolean DEFAULT false NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" "payment_request_kind" NOT NULL,
	"method" "payment_method" DEFAULT 'manual' NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"status" "payment_request_status" DEFAULT 'pending' NOT NULL,
	"upi_ref" text,
	"upi_id" text,
	"notes" text,
	"rejection_reason" text,
	"processed_by" text,
	"processed_at" timestamp with time zone,
	"ledger_entry_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "withdrawals" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"method" text DEFAULT 'upi' NOT NULL,
	"destination" text NOT NULL,
	"status" "withdrawal_status" DEFAULT 'pending' NOT NULL,
	"rejection_reason" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "fraud_flags" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"rule" text NOT NULL,
	"severity" "fraud_severity" DEFAULT 'medium' NOT NULL,
	"description" text,
	"metadata" jsonb,
	"resolved" boolean DEFAULT false NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_statuses" (
	"user_id" text PRIMARY KEY NOT NULL,
	"status" "wallet_status_value" DEFAULT 'active' NOT NULL,
	"reason" text,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_config" (
	"id" text PRIMARY KEY NOT NULL,
	"game_code" text NOT NULL,
	"rtp_min" double precision DEFAULT 95 NOT NULL,
	"rtp_max" double precision DEFAULT 97 NOT NULL,
	"max_multiplier" double precision DEFAULT 1000 NOT NULL,
	"max_stake_paise" bigint DEFAULT 50000000 NOT NULL,
	"house_edge" double precision DEFAULT 0.03 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "game_config_game_code_unique" UNIQUE("game_code")
);
--> statement-breakpoint
CREATE TABLE "game_rounds" (
	"id" text PRIMARY KEY NOT NULL,
	"game_code" text NOT NULL,
	"server_seed" text NOT NULL,
	"server_seed_hash" text NOT NULL,
	"client_seed" text NOT NULL,
	"nonce" bigint NOT NULL,
	"crash_point" double precision NOT NULL,
	"total_stake" bigint DEFAULT 0 NOT NULL,
	"total_payout" bigint DEFAULT 0 NOT NULL,
	"player_count" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"level" "app_log_level" DEFAULT 'info' NOT NULL,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"actor_id" text,
	"ip" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"sender_id" text NOT NULL,
	"sender_role" text NOT NULL,
	"body" text NOT NULL,
	"attachment_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"category" "ticket_category" NOT NULL,
	"subject" text NOT NULL,
	"status" "ticket_status" DEFAULT 'open' NOT NULL,
	"assignee_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" "notification_type" NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"link_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "banner_dismissals" (
	"id" text PRIMARY KEY NOT NULL,
	"banner_id" text NOT NULL,
	"user_id" text NOT NULL,
	"dismissed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "banners" (
	"id" text PRIMARY KEY NOT NULL,
	"type" "banner_type" DEFAULT 'info' NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"link_url" text,
	"sticky" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deposit_settings" ADD CONSTRAINT "deposit_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_processed_by_users_id_fk" FOREIGN KEY ("processed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_flags" ADD CONSTRAINT "fraud_flags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_flags" ADD CONSTRAINT "fraud_flags_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_statuses" ADD CONSTRAINT "wallet_statuses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_statuses" ADD CONSTRAINT "wallet_statuses_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "banner_dismissals" ADD CONSTRAINT "banner_dismissals_banner_id_banners_id_fk" FOREIGN KEY ("banner_id") REFERENCES "public"."banners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "banner_dismissals" ADD CONSTRAINT "banner_dismissals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "banners" ADD CONSTRAINT "banners_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_requests_user_id_idx" ON "payment_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "payment_requests_status_idx" ON "payment_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payment_requests_kind_idx" ON "payment_requests" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "payment_requests_created_at_idx" ON "payment_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "withdrawals_user_id_idx" ON "withdrawals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "withdrawals_status_idx" ON "withdrawals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "withdrawals_requested_at_idx" ON "withdrawals" USING btree ("requested_at");--> statement-breakpoint
CREATE INDEX "fraud_flags_user_id_idx" ON "fraud_flags" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "fraud_flags_rule_idx" ON "fraud_flags" USING btree ("rule");--> statement-breakpoint
CREATE INDEX "fraud_flags_resolved_idx" ON "fraud_flags" USING btree ("resolved");--> statement-breakpoint
CREATE INDEX "fraud_flags_created_at_idx" ON "fraud_flags" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "game_rounds_game_code_idx" ON "game_rounds" USING btree ("game_code");--> statement-breakpoint
CREATE INDEX "game_rounds_created_at_idx" ON "game_rounds" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "game_rounds_server_seed_hash_idx" ON "game_rounds" USING btree ("server_seed_hash");--> statement-breakpoint
CREATE INDEX "app_logs_kind_idx" ON "app_logs" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "app_logs_level_idx" ON "app_logs" USING btree ("level");--> statement-breakpoint
CREATE INDEX "app_logs_actor_idx" ON "app_logs" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "app_logs_created_at_idx" ON "app_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ticket_messages_ticket_idx" ON "ticket_messages" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "ticket_messages_created_at_idx" ON "ticket_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "tickets_user_id_idx" ON "tickets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tickets_status_idx" ON "tickets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tickets_category_idx" ON "tickets" USING btree ("category");--> statement-breakpoint
CREATE INDEX "tickets_assignee_idx" ON "tickets" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "tickets_created_at_idx" ON "tickets" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_id_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_read_idx" ON "notifications" USING btree ("user_id","read");--> statement-breakpoint
CREATE INDEX "notifications_created_at_idx" ON "notifications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "banner_dismissals_user_idx" ON "banner_dismissals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "banner_dismissals_banner_idx" ON "banner_dismissals" USING btree ("banner_id");--> statement-breakpoint
CREATE INDEX "banners_active_idx" ON "banners" USING btree ("active");--> statement-breakpoint
CREATE INDEX "banners_starts_at_idx" ON "banners" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "banners_ends_at_idx" ON "banners" USING btree ("ends_at");