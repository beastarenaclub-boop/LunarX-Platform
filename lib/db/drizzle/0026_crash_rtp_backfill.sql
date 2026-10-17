-- Backfill crash-game economics to real-Aviator levels (3% house edge,
-- RTP 97%). Migration 0008 seeded lunar at 0.70/30 and bootstrap seeded the
-- 8 crash variants the same way; defaults were changed in 0025 but existing
-- rows must be updated too so fresh-from-migrations DBs match.
UPDATE "game_config"
SET "house_edge" = 0.03,
    "rtp_min" = 97,
    "rtp_max" = 97,
    "updated_at" = now()
WHERE "game_code" IN (
  'lunar', 'aviator', 'jetx', 'aviatrix', 'aviajet',
  'fury', 'orizon', 'skydot', 'nomad'
)
AND "house_edge" = 0.70;
