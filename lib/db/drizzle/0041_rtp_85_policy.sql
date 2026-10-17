ALTER TABLE "game_config" ALTER COLUMN "rtp_min" SET DEFAULT 85;--> statement-breakpoint
ALTER TABLE "game_config" ALTER COLUMN "rtp_max" SET DEFAULT 85;--> statement-breakpoint
ALTER TABLE "game_config" ALTER COLUMN "house_edge" SET DEFAULT 0.15;--> statement-breakpoint
ALTER TABLE "game_config" ALTER COLUMN "settlement_mode" SET DEFAULT 'house_edge';--> statement-breakpoint
ALTER TABLE "game_rounds" ALTER COLUMN "house_edge" SET DEFAULT 0.15;--> statement-breakpoint
ALTER TABLE "blackjack_rounds" ADD COLUMN "payout_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "wingo_rounds" ADD COLUMN "payout_version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "blackjack_rounds" ALTER COLUMN "payout_version" SET DEFAULT 2;
--> statement-breakpoint
ALTER TABLE "wingo_rounds" ALTER COLUMN "payout_version" SET DEFAULT 2;
--> statement-breakpoint
CREATE UNIQUE INDEX "crash_round_panel_unique" ON "bets" ("round_id", "user_id", (metadata->>'crashPanel')) WHERE "round_id" LIKE 'crash-%';
--> statement-breakpoint
UPDATE bets AS b SET metadata = COALESCE(b.metadata, '{}'::jsonb) || jsonb_build_object('settlementMode', g.settlement_mode)
FROM game_config AS g WHERE b.game_code = g.game_code AND b.status IN ('placed', 'cashed_out') AND b.metadata->>'settlementMode' IS NULL;
