CREATE TABLE "forex_market" (
	"id" integer PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "forex_single_market" CHECK ("forex_market"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "forex_trades" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"request_id" text NOT NULL,
	"round_id" bigint NOT NULL,
	"asset" text NOT NULL,
	"side" text NOT NULL,
	"amount" integer NOT NULL,
	"payout" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"opened" bigint NOT NULL,
	"settled" bigint,
	"open_price" double precision NOT NULL,
	"close_price" double precision,
	CONSTRAINT "forex_amount_check" CHECK ("forex_trades"."amount" between 1000 and 500000 and "forex_trades"."amount" % 1000 = 0),
	CONSTRAINT "forex_payout_check" CHECK ("forex_trades"."payout" >= 0),
	CONSTRAINT "forex_side_check" CHECK ("forex_trades"."side" in ('buy', 'sell')),
	CONSTRAINT "forex_status_check" CHECK ("forex_trades"."status" in ('open', 'won', 'lost', 'refund'))
);
--> statement-breakpoint
ALTER TABLE "forex_trades" ADD CONSTRAINT "forex_trades_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "forex_user_request_idx" ON "forex_trades" USING btree ("user_id","request_id");--> statement-breakpoint
CREATE INDEX "forex_user_trades_idx" ON "forex_trades" USING btree ("user_id","opened");--> statement-breakpoint
CREATE INDEX "forex_round_trades_idx" ON "forex_trades" USING btree ("round_id");