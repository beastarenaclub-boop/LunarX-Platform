-- Add the new game only; existing game settings and bank headroom are retained.
INSERT INTO game_config (id, game_code, house_edge, rtp_min, rtp_max, max_multiplier,
  min_stake_paise, max_stake_paise, betting_window_ms, reveal_duration_ms, settle_duration_ms, settlement_mode)
VALUES ('ice-fish-v1', 'ice-fish', 0.045, 95.5, 95.5, 5000, 100, 500000, 12000, 14000, 4000, 'house_edge')
ON CONFLICT (game_code) DO NOTHING;
--> statement-breakpoint
INSERT INTO game_engine_config (stream_key, game_code, min_bank_floor_paise)
VALUES ('ice-fish', 'ice-fish', COALESCE((SELECT -floor_paise FROM engine_bank_budget WHERE scope = 'local' AND mode = 'same_each'), 0))
ON CONFLICT (stream_key) DO NOTHING;
