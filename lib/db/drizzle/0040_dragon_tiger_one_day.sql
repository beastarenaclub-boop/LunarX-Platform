CREATE TABLE "dragon_tiger_one_day_bets" (
	"id" serial PRIMARY KEY NOT NULL,
	"round_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"stage" text NOT NULL,
	"selections" jsonb NOT NULL,
	"stake_paise" bigint NOT NULL,
	"payout_paise" bigint
);
--> statement-breakpoint
CREATE TABLE "dragon_tiger_one_day_rounds" (
	"id" serial PRIMARY KEY NOT NULL,
	"dragon" integer NOT NULL,
	"tiger" integer NOT NULL,
	"nonce" text NOT NULL,
	"commitment" text NOT NULL,
	"first_closes_at" timestamp with time zone NOT NULL,
	"second_opens_at" timestamp with time zone NOT NULL,
	"second_closes_at" timestamp with time zone NOT NULL,
	"reveals_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "dragon_tiger_one_day_bets" ADD CONSTRAINT "dragon_tiger_one_day_bets_round_id_dragon_tiger_one_day_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."dragon_tiger_one_day_rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dragon_tiger_one_day_bets" ADD CONSTRAINT "dragon_tiger_one_day_bets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dt_one_day_round_user_stage" ON "dragon_tiger_one_day_bets" USING btree ("round_id","user_id","stage");--> statement-breakpoint
CREATE INDEX "dt_one_day_user_bets" ON "dragon_tiger_one_day_bets" USING btree ("user_id","id");