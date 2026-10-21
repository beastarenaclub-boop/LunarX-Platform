CREATE TABLE "poker_rounds" (
  "id" serial PRIMARY KEY, "game" text NOT NULL,
  "hands" jsonb NOT NULL, "board" jsonb NOT NULL, "nonce" text NOT NULL,
  "commitment" text NOT NULL, "quotes" jsonb NOT NULL,
  "closes_at" timestamptz NOT NULL, "reveals_at" timestamptz NOT NULL,
  "ends_at" timestamptz NOT NULL, "settled_at" timestamptz
);
--> statement-breakpoint
CREATE INDEX "poker_round_game" ON "poker_rounds" ("game", "id");
--> statement-breakpoint
CREATE TABLE "poker_bets" (
  "id" serial PRIMARY KEY, "round_id" integer NOT NULL REFERENCES "poker_rounds"("id"),
  "user_id" text NOT NULL REFERENCES "users"("id"), "request_id" text NOT NULL,
  "selections" jsonb NOT NULL, "stake_paise" bigint NOT NULL, "payout_paise" bigint,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "poker_request_user" ON "poker_bets" ("user_id", "request_id");
--> statement-breakpoint
CREATE INDEX "poker_bets_round" ON "poker_bets" ("round_id");
--> statement-breakpoint
CREATE INDEX "poker_bets_user" ON "poker_bets" ("user_id", "id");
