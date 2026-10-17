CREATE TABLE "prize_draws" (
	"id" text PRIMARY KEY NOT NULL,
	"closes" bigint NOT NULL,
	"ends" bigint NOT NULL,
	"seed" text NOT NULL,
	"commitment" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"result" text,
	"config" jsonb NOT NULL,
	CONSTRAINT "prize_draw_status" CHECK ("prize_draws"."status" in ('open','settled'))
);
--> statement-breakpoint
CREATE TABLE "prize_settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"value" jsonb NOT NULL,
	CONSTRAINT "prize_settings_singleton" CHECK ("prize_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "prize_tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"bet_id" text NOT NULL,
	"draw_id" text NOT NULL,
	"reward" text NOT NULL,
	"stake" bigint NOT NULL,
	"prize" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"claim_status" text DEFAULT 'none' NOT NULL,
	"delivery" jsonb,
	"request" text NOT NULL,
	"request_hash" text NOT NULL,
	"created" bigint NOT NULL,
	CONSTRAINT "prize_amounts" CHECK ("prize_tickets"."stake" >= 10000 and "prize_tickets"."prize" >= 0),
	CONSTRAINT "prize_ticket_status" CHECK ("prize_tickets"."status" in ('pending','won','lost','cancelled')),
	CONSTRAINT "prize_claim_status" CHECK ("prize_tickets"."claim_status" in ('none','available','requested','fulfilled','credited')),
	CONSTRAINT "prize_reward_check" CHECK ("prize_tickets"."reward" in ('cashback','shopping','giftcard','travel','gadgets','dining','fuel','gold'))
);
--> statement-breakpoint
ALTER TABLE "prize_tickets" ADD CONSTRAINT "prize_tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prize_tickets" ADD CONSTRAINT "prize_tickets_bet_id_bets_id_fk" FOREIGN KEY ("bet_id") REFERENCES "public"."bets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prize_tickets" ADD CONSTRAINT "prize_tickets_draw_id_prize_draws_id_fk" FOREIGN KEY ("draw_id") REFERENCES "public"."prize_draws"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prize_draw_end_idx" ON "prize_draws" USING btree ("ends");--> statement-breakpoint
CREATE UNIQUE INDEX "prize_request_idx" ON "prize_tickets" USING btree ("user_id","request");--> statement-breakpoint
CREATE UNIQUE INDEX "prize_bet_idx" ON "prize_tickets" USING btree ("bet_id");--> statement-breakpoint
CREATE INDEX "prize_user_idx" ON "prize_tickets" USING btree ("user_id","created");--> statement-breakpoint
CREATE INDEX "prize_draw_ticket_idx" ON "prize_tickets" USING btree ("draw_id","status");