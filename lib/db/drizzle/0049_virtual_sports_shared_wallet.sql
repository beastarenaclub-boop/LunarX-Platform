CREATE TABLE "virtual_sports_rounds" (
  "id" text PRIMARY KEY NOT NULL, "sport" text NOT NULL, "starts" bigint NOT NULL,
  "data" jsonb NOT NULL, "settled" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "virtual_sports_bets" (
  "id" text PRIMARY KEY NOT NULL, "user_id" text NOT NULL REFERENCES "users"("id"),
  "request_id" text NOT NULL, "round_id" text NOT NULL REFERENCES "virtual_sports_rounds"("id"),
  "sport" text NOT NULL, "choice" integer NOT NULL, "amount" integer NOT NULL,
  "odds_hundredths" integer NOT NULL, "payout" integer DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL, "created" bigint NOT NULL,
  CONSTRAINT "sports_amount_check" CHECK ("amount" BETWEEN 1000 AND 500000 AND "amount" % 100 = 0),
  CONSTRAINT "sports_payout_check" CHECK ("payout" >= 0),
  CONSTRAINT "sports_status_check" CHECK ("status" IN ('pending', 'won', 'lost')),
  CONSTRAINT "sports_choice_check" CHECK ("choice" BETWEEN 0 AND 3),
  CONSTRAINT "sports_odds_check" CHECK ("odds_hundredths" >= 100)
);
--> statement-breakpoint
CREATE INDEX "sports_round_starts_idx" ON "virtual_sports_rounds" ("starts");
CREATE INDEX "sports_unsettled_idx" ON "virtual_sports_rounds" ("settled", "starts");
CREATE UNIQUE INDEX "sports_user_request_idx" ON "virtual_sports_bets" ("user_id", "request_id");
CREATE INDEX "sports_user_bets_idx" ON "virtual_sports_bets" ("user_id", "created");
CREATE INDEX "sports_round_bets_idx" ON "virtual_sports_bets" ("round_id", "status");
