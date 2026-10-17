CREATE TABLE "lucky_7_rounds" (
	"id" text PRIMARY KEY NOT NULL,
	"bet_id" text NOT NULL,
	"user_id" text NOT NULL,
	"server_seed" text NOT NULL,
	"server_seed_hash" text NOT NULL,
	"client_seed" text NOT NULL,
	"nonce" bigint NOT NULL,
	"die_1" integer NOT NULL,
	"die_2" integer NOT NULL,
	"total" integer NOT NULL,
	"bets" jsonb NOT NULL,
	"total_stake" bigint NOT NULL,
	"payout_amount" bigint NOT NULL,
	"multiplier" double precision NOT NULL,
	"house_edge" double precision NOT NULL,
	"max_multiplier" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lucky_7_rounds_bet_id_unique" UNIQUE("bet_id")
);
--> statement-breakpoint
CREATE TABLE "table_round_bets" (
	"id" text PRIMARY KEY NOT NULL,
	"round_id" text NOT NULL,
	"game_code" text NOT NULL,
	"user_id" text NOT NULL,
	"bet_id" text NOT NULL,
	"bets" jsonb NOT NULL,
	"total_stake" bigint NOT NULL,
	"payout_amount" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"audit_round_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "table_rounds" (
	"id" text PRIMARY KEY NOT NULL,
	"game_code" text NOT NULL,
	"phase" text DEFAULT 'betting' NOT NULL,
	"server_seed" text NOT NULL,
	"server_seed_hash" text NOT NULL,
	"client_seed" text NOT NULL,
	"nonce" bigint DEFAULT 0 NOT NULL,
	"betting_ends_at" timestamp with time zone NOT NULL,
	"reveal_ends_at" timestamp with time zone NOT NULL,
	"settle_ends_at" timestamp with time zone NOT NULL,
	"outcome" jsonb,
	"config" jsonb NOT NULL,
	"total_stake" bigint DEFAULT 0 NOT NULL,
	"total_payout" bigint DEFAULT 0 NOT NULL,
	"player_count" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "game_config" ADD COLUMN "reveal_duration_ms" bigint DEFAULT 5000 NOT NULL;--> statement-breakpoint
ALTER TABLE "game_config" ADD COLUMN "settle_duration_ms" bigint DEFAULT 5000 NOT NULL;--> statement-breakpoint
ALTER TABLE "game_config" ADD COLUMN "min_stake_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "lucky_7_rounds" ADD CONSTRAINT "lucky_7_rounds_bet_id_bets_id_fk" FOREIGN KEY ("bet_id") REFERENCES "public"."bets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lucky_7_rounds" ADD CONSTRAINT "lucky_7_rounds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_round_bets" ADD CONSTRAINT "table_round_bets_round_id_table_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."table_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lucky_7_rounds_user_id_idx" ON "lucky_7_rounds" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "lucky_7_rounds_created_at_idx" ON "lucky_7_rounds" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "table_round_bets_round_id_idx" ON "table_round_bets" USING btree ("round_id");--> statement-breakpoint
CREATE INDEX "table_round_bets_user_id_idx" ON "table_round_bets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "table_round_bets_status_idx" ON "table_round_bets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "table_rounds_game_code_idx" ON "table_rounds" USING btree ("game_code");--> statement-breakpoint
CREATE INDEX "table_rounds_phase_idx" ON "table_rounds" USING btree ("phase");--> statement-breakpoint
CREATE INDEX "table_rounds_created_at_idx" ON "table_rounds" USING btree ("created_at");