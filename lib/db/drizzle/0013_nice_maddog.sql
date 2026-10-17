CREATE TYPE "public"."dice_direction" AS ENUM('over', 'under');--> statement-breakpoint
CREATE TABLE "dice_rounds" (
	"id" text PRIMARY KEY NOT NULL,
	"bet_id" text NOT NULL,
	"user_id" text NOT NULL,
	"server_seed" text NOT NULL,
	"server_seed_hash" text NOT NULL,
	"client_seed" text NOT NULL,
	"nonce" bigint NOT NULL,
	"target" double precision NOT NULL,
	"direction" "dice_direction" NOT NULL,
	"roll" double precision NOT NULL,
	"did_win" boolean NOT NULL,
	"multiplier" double precision NOT NULL,
	"payout_amount" bigint NOT NULL,
	"house_edge" double precision NOT NULL,
	"max_multiplier" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dice_rounds_bet_id_unique" UNIQUE("bet_id")
);
--> statement-breakpoint
CREATE TABLE "dice_user_seeds" (
	"user_id" text PRIMARY KEY NOT NULL,
	"server_seed" text NOT NULL,
	"server_seed_hash" text NOT NULL,
	"client_seed" text NOT NULL,
	"next_nonce" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_rotated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dice_rounds" ADD CONSTRAINT "dice_rounds_bet_id_bets_id_fk" FOREIGN KEY ("bet_id") REFERENCES "public"."bets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dice_rounds" ADD CONSTRAINT "dice_rounds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dice_user_seeds" ADD CONSTRAINT "dice_user_seeds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dice_rounds_user_id_idx" ON "dice_rounds" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "dice_rounds_created_at_idx" ON "dice_rounds" USING btree ("created_at");