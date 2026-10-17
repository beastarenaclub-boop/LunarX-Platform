ALTER TABLE "game_config" ADD COLUMN "betting_window_ms" bigint DEFAULT 5000 NOT NULL;--> statement-breakpoint
ALTER TABLE "game_config" ADD COLUMN "turbo_betting_window_ms" bigint DEFAULT 2500 NOT NULL;--> statement-breakpoint
ALTER TABLE "game_config" ADD COLUMN "inter_round_delay_ms" bigint DEFAULT 2500 NOT NULL;--> statement-breakpoint
ALTER TABLE "game_config" ADD COLUMN "min_auto_cashout" double precision DEFAULT 1.01 NOT NULL;--> statement-breakpoint
ALTER TABLE "game_config" ADD COLUMN "max_auto_cashout" double precision DEFAULT 1000 NOT NULL;