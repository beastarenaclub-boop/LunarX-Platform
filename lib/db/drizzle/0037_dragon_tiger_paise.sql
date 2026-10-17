ALTER TABLE "dragon_tiger_bets" ALTER COLUMN "payout" SET DATA TYPE numeric(12, 2);--> statement-breakpoint
ALTER TABLE "dragon_tiger_players" ALTER COLUMN "net" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
-- Existing rounds retain the rates shown when their bets were accepted.
ALTER TABLE "dragon_tiger_rounds" ADD COLUMN "main_profit_paise_per_rupee" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "dragon_tiger_rounds" ADD COLUMN "tie_profit_paise_per_rupee" integer DEFAULT 1100 NOT NULL;--> statement-breakpoint
ALTER TABLE "dragon_tiger_rounds" ALTER COLUMN "main_profit_paise_per_rupee" SET DEFAULT 98;--> statement-breakpoint
ALTER TABLE "dragon_tiger_rounds" ALTER COLUMN "tie_profit_paise_per_rupee" SET DEFAULT 1200;
