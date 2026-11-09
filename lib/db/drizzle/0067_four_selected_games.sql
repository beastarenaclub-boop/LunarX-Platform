-- Withdraw only the two additional games, preserving wallets and round history.
UPDATE game_config SET enabled = false WHERE game_code IN ('rummy-royale', 'speed-auto-roulette');
--> statement-breakpoint
-- Removing old-game banks from a combined budget must not change its remaining
-- headroom: new floor = old floor - the excluded historical bank balances.
UPDATE engine_bank_budget AS budget
SET floor_paise = budget.floor_paise - COALESCE((
  SELECT SUM(bank_paise) FROM game_engine_config AS game
  WHERE COALESCE(game.partner_id, 'local') = budget.scope
    AND game.game_code NOT IN ('roulette-american', 'roulette-mini', 'fun-target')
), 0)
WHERE budget.mode = 'combined';
