ALTER TABLE "game_config" ALTER COLUMN "rtp_min" SET DEFAULT 30;--> statement-breakpoint
ALTER TABLE "game_config" ALTER COLUMN "rtp_max" SET DEFAULT 30;--> statement-breakpoint
ALTER TABLE "game_config" ALTER COLUMN "house_edge" SET DEFAULT 0.7;--> statement-breakpoint
ALTER TABLE "game_rounds" ADD COLUMN "house_edge" double precision DEFAULT 0.7 NOT NULL;--> statement-breakpoint
ALTER TABLE "game_rounds" ADD COLUMN "max_multiplier" double precision DEFAULT 1000 NOT NULL;--> statement-breakpoint

-- Idempotent backfill: bring the existing lunar config row in line with the
-- new operator-mandated defaults (RTP 30%, house edge 70%). Insert if it does
-- not yet exist so a fresh DB also has the row.
UPDATE "game_config"
   SET "rtp_min" = 30,
       "rtp_max" = 30,
       "house_edge" = 0.70,
       "updated_at" = NOW()
 WHERE "game_code" = 'lunar';--> statement-breakpoint

INSERT INTO "game_config" ("id", "game_code", "rtp_min", "rtp_max", "house_edge")
VALUES ('seed-lunar-config', 'lunar', 30, 30, 0.70)
ON CONFLICT ("game_code") DO NOTHING;
