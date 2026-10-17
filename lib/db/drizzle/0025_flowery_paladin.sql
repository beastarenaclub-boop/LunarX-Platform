ALTER TABLE "game_config" ALTER COLUMN "rtp_min" SET DEFAULT 97;--> statement-breakpoint
ALTER TABLE "game_config" ALTER COLUMN "rtp_max" SET DEFAULT 97;--> statement-breakpoint
ALTER TABLE "game_config" ALTER COLUMN "house_edge" SET DEFAULT 0.03;--> statement-breakpoint
ALTER TABLE "game_rounds" ALTER COLUMN "house_edge" SET DEFAULT 0.03;