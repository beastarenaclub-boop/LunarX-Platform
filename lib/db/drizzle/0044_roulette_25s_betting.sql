-- Apply only to future rounds. Active rounds retain their accepted deadlines.
UPDATE game_config
SET betting_window_ms = 25000, updated_at = now()
WHERE game_code = 'roulette';
