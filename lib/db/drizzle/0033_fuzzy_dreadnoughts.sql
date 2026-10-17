CREATE TABLE "teen_patti_live_rounds" (
	"id" text PRIMARY KEY NOT NULL,
	"bet_id" text NOT NULL,
	"user_id" text NOT NULL,
	"server_seed" text NOT NULL,
	"server_seed_hash" text NOT NULL,
	"client_seed" text NOT NULL,
	"nonce" bigint NOT NULL,
	"hand_a_cards" jsonb NOT NULL,
	"hand_b_cards" jsonb NOT NULL,
	"hand_a_category" text NOT NULL,
	"hand_b_category" text NOT NULL,
	"winner" text NOT NULL,
	"bets" jsonb NOT NULL,
	"total_stake" bigint NOT NULL,
	"payout_amount" bigint NOT NULL,
	"multiplier" double precision NOT NULL,
	"max_multiplier" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teen_patti_live_rounds_bet_id_unique" UNIQUE("bet_id")
);
--> statement-breakpoint
ALTER TABLE "teen_patti_live_rounds" ADD CONSTRAINT "teen_patti_live_rounds_bet_id_bets_id_fk" FOREIGN KEY ("bet_id") REFERENCES "public"."bets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teen_patti_live_rounds" ADD CONSTRAINT "teen_patti_live_rounds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "teen_patti_live_rounds_user_id_idx" ON "teen_patti_live_rounds" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "teen_patti_live_rounds_created_at_idx" ON "teen_patti_live_rounds" USING btree ("created_at");