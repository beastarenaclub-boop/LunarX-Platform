CREATE TYPE "public"."partner_api_key_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."partner_status" AS ENUM('active', 'suspended', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."partner_wallet_mode" AS ENUM('local-credits', 'remote-wallet');--> statement-breakpoint
CREATE TYPE "public"."webhook_delivery_status" AS ENUM('pending', 'delivering', 'delivered', 'failed');--> statement-breakpoint
CREATE TABLE "partner_api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"partner_id" text NOT NULL,
	"key_id" text NOT NULL,
	"secret_hash" text NOT NULL,
	"label" text,
	"status" "partner_api_key_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "partner_player_links" (
	"id" text PRIMARY KEY NOT NULL,
	"partner_id" text NOT NULL,
	"player_ref" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_request_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"partner_id" text,
	"api_key_id" text,
	"request_id" text,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"status_code" integer NOT NULL,
	"latency_ms" integer NOT NULL,
	"ip" text,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_request_nonces" (
	"id" text PRIMARY KEY NOT NULL,
	"api_key_id" text NOT NULL,
	"nonce" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_wallets" (
	"id" text PRIMARY KEY NOT NULL,
	"partner_id" text NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"balance_paise" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"contact_email" text,
	"allowed_games" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"allowed_origins" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"wallet_mode" "partner_wallet_mode" DEFAULT 'local-credits' NOT NULL,
	"rtp_override" double precision,
	"status" "partner_status" DEFAULT 'active' NOT NULL,
	"webhook_url" text,
	"webhook_secret" text,
	"wallet_callback_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"partner_id" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "webhook_delivery_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_response_status" integer,
	"last_response_body" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bets" ADD COLUMN "partner_id" text;--> statement-breakpoint
ALTER TABLE "bets" ADD COLUMN "partner_bet_id" text;--> statement-breakpoint
ALTER TABLE "bets" ADD COLUMN "partner_player_ref" text;--> statement-breakpoint
ALTER TABLE "game_rounds" ADD COLUMN "partner_id" text;--> statement-breakpoint
ALTER TABLE "game_rounds" ADD COLUMN "partner_round_id" text;--> statement-breakpoint
ALTER TABLE "partner_api_keys" ADD CONSTRAINT "partner_api_keys_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_player_links" ADD CONSTRAINT "partner_player_links_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_request_logs" ADD CONSTRAINT "partner_request_logs_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_wallets" ADD CONSTRAINT "partner_wallets_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "partner_api_keys_key_id_idx" ON "partner_api_keys" USING btree ("key_id");--> statement-breakpoint
CREATE INDEX "partner_api_keys_partner_id_idx" ON "partner_api_keys" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "partner_api_keys_status_idx" ON "partner_api_keys" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_player_links_partner_ref_idx" ON "partner_player_links" USING btree ("partner_id","player_ref");--> statement-breakpoint
CREATE INDEX "partner_player_links_user_id_idx" ON "partner_player_links" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "partner_request_logs_partner_id_idx" ON "partner_request_logs" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "partner_request_logs_created_at_idx" ON "partner_request_logs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_request_nonces_key_nonce_idx" ON "partner_request_nonces" USING btree ("api_key_id","nonce");--> statement-breakpoint
CREATE INDEX "partner_request_nonces_created_at_idx" ON "partner_request_nonces" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_wallets_partner_currency_idx" ON "partner_wallets" USING btree ("partner_id","currency");--> statement-breakpoint
CREATE INDEX "partners_status_idx" ON "partners" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_event_id_idx" ON "webhook_deliveries" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_partner_id_idx" ON "webhook_deliveries" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_status_next_attempt_idx" ON "webhook_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_created_at_idx" ON "webhook_deliveries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "bets_partner_id_idx" ON "bets" USING btree ("partner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bets_partner_bet_id_unique_idx" ON "bets" USING btree ("partner_id","partner_bet_id") WHERE "bets"."partner_id" IS NOT NULL AND "bets"."partner_bet_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "game_rounds_partner_id_idx" ON "game_rounds" USING btree ("partner_id");