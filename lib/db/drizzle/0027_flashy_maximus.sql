CREATE TABLE "roulette_rounds" (
	"id" text PRIMARY KEY NOT NULL,
	"bet_id" text NOT NULL,
	"user_id" text NOT NULL,
	"server_seed" text NOT NULL,
	"server_seed_hash" text NOT NULL,
	"client_seed" text NOT NULL,
	"nonce" bigint NOT NULL,
	"pocket" integer NOT NULL,
	"bets" jsonb NOT NULL,
	"total_stake" bigint NOT NULL,
	"payout_amount" bigint NOT NULL,
	"multiplier" double precision NOT NULL,
	"house_edge" double precision NOT NULL,
	"max_multiplier" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roulette_rounds_bet_id_unique" UNIQUE("bet_id")
);
--> statement-breakpoint
CREATE TABLE "roulette_user_seeds" (
	"user_id" text PRIMARY KEY NOT NULL,
	"server_seed" text NOT NULL,
	"server_seed_hash" text NOT NULL,
	"client_seed" text NOT NULL,
	"next_nonce" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_rotated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "baccarat_rounds" (
	"id" text PRIMARY KEY NOT NULL,
	"bet_id" text NOT NULL,
	"user_id" text NOT NULL,
	"server_seed" text NOT NULL,
	"server_seed_hash" text NOT NULL,
	"client_seed" text NOT NULL,
	"nonce" bigint NOT NULL,
	"player_cards" jsonb NOT NULL,
	"banker_cards" jsonb NOT NULL,
	"player_total" integer NOT NULL,
	"banker_total" integer NOT NULL,
	"winner" text NOT NULL,
	"player_pair" boolean NOT NULL,
	"banker_pair" boolean NOT NULL,
	"bets" jsonb NOT NULL,
	"total_stake" bigint NOT NULL,
	"payout_amount" bigint NOT NULL,
	"multiplier" double precision NOT NULL,
	"max_multiplier" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "baccarat_rounds_bet_id_unique" UNIQUE("bet_id")
);
--> statement-breakpoint
CREATE TABLE "baccarat_user_seeds" (
	"user_id" text PRIMARY KEY NOT NULL,
	"server_seed" text NOT NULL,
	"server_seed_hash" text NOT NULL,
	"client_seed" text NOT NULL,
	"next_nonce" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_rotated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "game_rounds" ADD COLUMN "derivation_version" bigint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "roulette_rounds" ADD CONSTRAINT "roulette_rounds_bet_id_bets_id_fk" FOREIGN KEY ("bet_id") REFERENCES "public"."bets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roulette_rounds" ADD CONSTRAINT "roulette_rounds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roulette_user_seeds" ADD CONSTRAINT "roulette_user_seeds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baccarat_rounds" ADD CONSTRAINT "baccarat_rounds_bet_id_bets_id_fk" FOREIGN KEY ("bet_id") REFERENCES "public"."bets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baccarat_rounds" ADD CONSTRAINT "baccarat_rounds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baccarat_user_seeds" ADD CONSTRAINT "baccarat_user_seeds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "roulette_rounds_user_id_idx" ON "roulette_rounds" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "roulette_rounds_created_at_idx" ON "roulette_rounds" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "baccarat_rounds_user_id_idx" ON "baccarat_rounds" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "baccarat_rounds_created_at_idx" ON "baccarat_rounds" USING btree ("created_at");