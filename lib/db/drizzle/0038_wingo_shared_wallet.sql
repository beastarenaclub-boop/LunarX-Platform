CREATE TABLE "wingo_bets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"period" text NOT NULL,
	"pick" text NOT NULL,
	"stake" integer NOT NULL,
	"payout" integer,
	"created" bigint NOT NULL,
	"request" text NOT NULL,
	CONSTRAINT "wingo_stake_check" CHECK ("wingo_bets"."stake" between 100 and 1000000 and "wingo_bets"."stake" % 100 = 0),
	CONSTRAINT "wingo_payout_check" CHECK ("wingo_bets"."payout" >= 0)
);
--> statement-breakpoint
CREATE TABLE "wingo_rounds" (
	"period" text PRIMARY KEY NOT NULL,
	"duration" integer NOT NULL,
	"start" bigint NOT NULL,
	"ends" bigint NOT NULL,
	"number" integer NOT NULL,
	"secret" text NOT NULL,
	"commitment" text NOT NULL,
	"settled" boolean DEFAULT false NOT NULL,
	CONSTRAINT "wingo_number_check" CHECK ("wingo_rounds"."number" between 0 and 9)
);
--> statement-breakpoint
ALTER TABLE "wingo_bets" ADD CONSTRAINT "wingo_bets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wingo_bets" ADD CONSTRAINT "wingo_bets_period_wingo_rounds_period_fk" FOREIGN KEY ("period") REFERENCES "public"."wingo_rounds"("period") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wingo_user_request_idx" ON "wingo_bets" USING btree ("user_id","request");--> statement-breakpoint
CREATE INDEX "wingo_user_bets_idx" ON "wingo_bets" USING btree ("user_id","created");--> statement-breakpoint
CREATE INDEX "wingo_bet_round_idx" ON "wingo_bets" USING btree ("period");--> statement-breakpoint
CREATE INDEX "wingo_round_time_idx" ON "wingo_rounds" USING btree ("duration","ends");--> statement-breakpoint
CREATE INDEX "wingo_unsettled_idx" ON "wingo_rounds" USING btree ("ends") WHERE "wingo_rounds"."settled" = false;