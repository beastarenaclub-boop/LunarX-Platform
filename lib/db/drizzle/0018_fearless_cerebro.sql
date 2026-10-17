CREATE TABLE "round_settlement_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"settlement_id" text NOT NULL,
	"round_id" text NOT NULL,
	"user_id" text NOT NULL,
	"bet_id" text NOT NULL,
	"stake" bigint NOT NULL,
	"cashout_multiplier" double precision,
	"payout" bigint NOT NULL,
	"profit" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "round_settlements" (
	"id" text PRIMARY KEY NOT NULL,
	"round_id" text NOT NULL,
	"game_code" text NOT NULL,
	"total_pool" bigint NOT NULL,
	"player_pool" bigint NOT NULL,
	"company_profit" bigint NOT NULL,
	"winner_count" integer DEFAULT 0 NOT NULL,
	"loser_count" integer DEFAULT 0 NOT NULL,
	"settled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "game_config" ADD COLUMN "settlement_mode" text DEFAULT 'pari_mutuel' NOT NULL;--> statement-breakpoint
ALTER TABLE "round_settlement_entries" ADD CONSTRAINT "round_settlement_entries_settlement_id_round_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."round_settlements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_settlement_entries" ADD CONSTRAINT "round_settlement_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rse_settlement_id_idx" ON "round_settlement_entries" USING btree ("settlement_id");--> statement-breakpoint
CREATE INDEX "rse_round_id_idx" ON "round_settlement_entries" USING btree ("round_id");--> statement-breakpoint
CREATE INDEX "rse_user_id_idx" ON "round_settlement_entries" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rse_bet_id_unique_idx" ON "round_settlement_entries" USING btree ("bet_id");--> statement-breakpoint
CREATE UNIQUE INDEX "round_settlements_round_game_unique_idx" ON "round_settlements" USING btree ("round_id","game_code");--> statement-breakpoint
CREATE INDEX "round_settlements_settled_at_idx" ON "round_settlements" USING btree ("settled_at");--> statement-breakpoint
CREATE INDEX "round_settlements_game_code_idx" ON "round_settlements" USING btree ("game_code");