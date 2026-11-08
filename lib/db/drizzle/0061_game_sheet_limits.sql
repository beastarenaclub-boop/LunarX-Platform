-- Requested six stake buttons: 100, 500, 1000, 10000, 25000, 50000 rupees.
-- One-time increase for future bets. Accepted rounds keep their saved terms.
UPDATE game_config
SET max_stake_paise = GREATEST(max_stake_paise, 5000000), updated_at = now()
WHERE game_code IN (
  'ludo', 'lucky-7-live', 'wheel-2-live', 'poker-20-20', 'crazy-time',
  'chicken-road', '7up7down', 'jetx', 'fury', 'mines', 'coin-flip', 'plinko'
);
