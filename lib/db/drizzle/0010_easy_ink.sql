CREATE TYPE "public"."mines_round_status" AS ENUM('active', 'cashed_out', 'busted');--> statement-breakpoint
CREATE TABLE "mines_rounds" (
	"id" text PRIMARY KEY NOT NULL,
	"bet_id" text NOT NULL,
	"user_id" text NOT NULL,
	"server_seed" text NOT NULL,
	"server_seed_hash" text NOT NULL,
	"client_seed" text NOT NULL,
	"nonce" bigint NOT NULL,
	"grid_size" integer NOT NULL,
	"mine_count" integer NOT NULL,
	"mine_indexes" jsonb NOT NULL,
	"revealed_indexes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"house_edge" double precision NOT NULL,
	"max_multiplier" double precision NOT NULL,
	"multiplier" double precision DEFAULT 1 NOT NULL,
	"status" "mines_round_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "mines_rounds_bet_id_unique" UNIQUE("bet_id")
);
--> statement-breakpoint
ALTER TABLE "mines_rounds" ADD CONSTRAINT "mines_rounds_bet_id_bets_id_fk" FOREIGN KEY ("bet_id") REFERENCES "public"."bets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mines_rounds" ADD CONSTRAINT "mines_rounds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mines_rounds_user_id_idx" ON "mines_rounds" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mines_rounds_status_idx" ON "mines_rounds" USING btree ("status");--> statement-breakpoint
CREATE INDEX "mines_rounds_created_at_idx" ON "mines_rounds" USING btree ("created_at");