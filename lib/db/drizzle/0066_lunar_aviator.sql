-- Reopen the canonical Lunar game once when the kit Aviator UI ships.
-- Keep saved RTP, limits and historical rounds; later admin disables persist.
UPDATE "game_config" SET "enabled" = true WHERE "game_code" = 'lunar';
