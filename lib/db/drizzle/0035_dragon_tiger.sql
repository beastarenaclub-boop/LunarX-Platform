CREATE TABLE "dragon_tiger_bets" (
	"id" serial PRIMARY KEY NOT NULL,
	"round_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"spots" jsonb NOT NULL,
	"stake" integer NOT NULL,
	"payout" integer
);
--> statement-breakpoint
CREATE TABLE "dragon_tiger_players" (
	"user_id" text PRIMARY KEY NOT NULL,
	"balance" integer DEFAULT 10000 NOT NULL,
	"net" integer DEFAULT 0 NOT NULL,
	"played" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dragon_tiger_rounds" (
	"id" serial PRIMARY KEY NOT NULL,
	"dragon" integer NOT NULL,
	"tiger" integer NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"reveals_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "dragon_tiger_bets" ADD CONSTRAINT "dragon_tiger_bets_round_id_dragon_tiger_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."dragon_tiger_rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dragon_tiger_bets" ADD CONSTRAINT "dragon_tiger_bets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dragon_tiger_players" ADD CONSTRAINT "dragon_tiger_players_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dragon_tiger_one_bet_idx" ON "dragon_tiger_bets" USING btree ("round_id","user_id");--> statement-breakpoint
CREATE INDEX "dragon_tiger_user_bets_idx" ON "dragon_tiger_bets" USING btree ("user_id","id");--> statement-breakpoint
CREATE INDEX "dragon_tiger_ranking_idx" ON "dragon_tiger_players" USING btree ("net","wins");