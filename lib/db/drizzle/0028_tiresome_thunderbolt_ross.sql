CREATE TABLE "blackjack_rounds" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"bet_id" text NOT NULL,
	"split_bet_id" text,
	"double_main_bet_id" text,
	"double_split_bet_id" text,
	"insurance_bet_id" text,
	"server_seed" text NOT NULL,
	"server_seed_hash" text NOT NULL,
	"client_seed" text NOT NULL,
	"nonce" bigint NOT NULL,
	"status" text NOT NULL,
	"stake_amount" bigint NOT NULL,
	"hands" jsonb NOT NULL,
	"active_hand" integer DEFAULT 0 NOT NULL,
	"dealer_cards" jsonb NOT NULL,
	"drawn_count" integer NOT NULL,
	"insurance" text,
	"actions" jsonb NOT NULL,
	"results" jsonb,
	"total_stake" bigint NOT NULL,
	"payout_amount" bigint NOT NULL,
	"max_multiplier" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_action_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "blackjack_rounds_bet_id_unique" UNIQUE("bet_id")
);
--> statement-breakpoint
CREATE TABLE "blackjack_user_seeds" (
	"user_id" text PRIMARY KEY NOT NULL,
	"server_seed" text NOT NULL,
	"server_seed_hash" text NOT NULL,
	"client_seed" text NOT NULL,
	"next_nonce" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_rotated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "blackjack_rounds" ADD CONSTRAINT "blackjack_rounds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blackjack_rounds" ADD CONSTRAINT "blackjack_rounds_bet_id_bets_id_fk" FOREIGN KEY ("bet_id") REFERENCES "public"."bets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blackjack_rounds" ADD CONSTRAINT "blackjack_rounds_split_bet_id_bets_id_fk" FOREIGN KEY ("split_bet_id") REFERENCES "public"."bets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blackjack_rounds" ADD CONSTRAINT "blackjack_rounds_double_main_bet_id_bets_id_fk" FOREIGN KEY ("double_main_bet_id") REFERENCES "public"."bets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blackjack_rounds" ADD CONSTRAINT "blackjack_rounds_double_split_bet_id_bets_id_fk" FOREIGN KEY ("double_split_bet_id") REFERENCES "public"."bets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blackjack_rounds" ADD CONSTRAINT "blackjack_rounds_insurance_bet_id_bets_id_fk" FOREIGN KEY ("insurance_bet_id") REFERENCES "public"."bets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blackjack_user_seeds" ADD CONSTRAINT "blackjack_user_seeds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "blackjack_rounds_user_id_idx" ON "blackjack_rounds" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "blackjack_rounds_created_at_idx" ON "blackjack_rounds" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "blackjack_rounds_active_per_user_idx" ON "blackjack_rounds" USING btree ("user_id") WHERE "blackjack_rounds"."status" <> 'settled';