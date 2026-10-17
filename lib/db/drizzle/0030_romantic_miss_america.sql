CREATE TABLE "teen_patti_rounds" (
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
	CONSTRAINT "teen_patti_rounds_bet_id_unique" UNIQUE("bet_id")
);
--> statement-breakpoint
CREATE TABLE "teen_patti_user_seeds" (
	"user_id" text PRIMARY KEY NOT NULL,
	"server_seed" text NOT NULL,
	"server_seed_hash" text NOT NULL,
	"client_seed" text NOT NULL,
	"next_nonce" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_rotated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "teen_patti_rounds" ADD CONSTRAINT "teen_patti_rounds_bet_id_bets_id_fk" FOREIGN KEY ("bet_id") REFERENCES "public"."bets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teen_patti_rounds" ADD CONSTRAINT "teen_patti_rounds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teen_patti_user_seeds" ADD CONSTRAINT "teen_patti_user_seeds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "teen_patti_rounds_user_id_idx" ON "teen_patti_rounds" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "teen_patti_rounds_created_at_idx" ON "teen_patti_rounds" USING btree ("created_at");