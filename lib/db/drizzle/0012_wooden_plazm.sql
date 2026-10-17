CREATE TYPE "public"."plinko_risk" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TABLE "plinko_rounds" (
	"id" text PRIMARY KEY NOT NULL,
	"bet_id" text NOT NULL,
	"user_id" text NOT NULL,
	"server_seed" text NOT NULL,
	"server_seed_hash" text NOT NULL,
	"client_seed" text NOT NULL,
	"nonce" bigint NOT NULL,
	"rows" integer NOT NULL,
	"risk" "plinko_risk" NOT NULL,
	"path" jsonb NOT NULL,
	"bucket" integer NOT NULL,
	"multiplier" double precision NOT NULL,
	"payout_amount" bigint NOT NULL,
	"house_edge" double precision NOT NULL,
	"max_multiplier" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plinko_rounds_bet_id_unique" UNIQUE("bet_id")
);
--> statement-breakpoint
CREATE TABLE "plinko_user_seeds" (
	"user_id" text PRIMARY KEY NOT NULL,
	"server_seed" text NOT NULL,
	"server_seed_hash" text NOT NULL,
	"client_seed" text NOT NULL,
	"next_nonce" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_rotated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plinko_rounds" ADD CONSTRAINT "plinko_rounds_bet_id_bets_id_fk" FOREIGN KEY ("bet_id") REFERENCES "public"."bets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plinko_rounds" ADD CONSTRAINT "plinko_rounds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plinko_user_seeds" ADD CONSTRAINT "plinko_user_seeds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plinko_rounds_user_id_idx" ON "plinko_rounds" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "plinko_rounds_created_at_idx" ON "plinko_rounds" USING btree ("created_at");