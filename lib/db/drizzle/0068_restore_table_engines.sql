-- Reconnect existing tables without resetting operator modes or parameters.
INSERT INTO game_engine_config (stream_key, game_code)
SELECT code, code FROM unnest(ARRAY[
  'roulette', 'baccarat', 'teen-patti', 'teen-patti-live', 'teen-patti-joker',
  'andar-bahar', 'lucky-7', 'lucky-7-live', 'wheel-2-live', 'coin-flip',
  '7up7down', 'vegetable-bowl', 'crazy-time', 'mega-ball'
]) AS games(code)
ON CONFLICT (stream_key) DO NOTHING;
--> statement-breakpoint
-- Adding historical banks back must preserve the current shared headroom.
UPDATE engine_bank_budget AS budget
SET floor_paise = budget.floor_paise + COALESCE((
  SELECT SUM(bank_paise) FROM game_engine_config AS game
  WHERE COALESCE(game.partner_id, 'local') = budget.scope
    AND game.game_code IN (
      'roulette', 'baccarat', 'teen-patti', 'teen-patti-live', 'teen-patti-joker',
      'andar-bahar', 'lucky-7', 'lucky-7-live', 'wheel-2-live', 'coin-flip',
      '7up7down', 'vegetable-bowl', 'crazy-time', 'mega-ball'
    )
), 0)
WHERE budget.mode = 'combined';
--> statement-breakpoint
-- A shared per-game allowance also applies to each reconnected table, frozen
-- against its current bank. Retained tables and individual budgets stay intact.
UPDATE game_engine_config AS game
SET min_bank_floor_paise = game.bank_paise - budget.floor_paise
FROM engine_bank_budget AS budget
WHERE budget.mode = 'same_each'
  AND COALESCE(game.partner_id, 'local') = budget.scope
  AND game.game_code IN (
    'roulette', 'baccarat', 'teen-patti', 'teen-patti-live', 'teen-patti-joker',
    'andar-bahar', 'lucky-7', 'lucky-7-live', 'wheel-2-live', 'coin-flip',
    '7up7down', 'vegetable-bowl', 'crazy-time', 'mega-ball'
  );
