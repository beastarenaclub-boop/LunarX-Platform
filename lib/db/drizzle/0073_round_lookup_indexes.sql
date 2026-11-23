-- On an existing large production database, prebuild these with CONCURRENTLY
-- using scripts/round-lookup-indexes.cjs before the migration runs. IF NOT
-- EXISTS then records the migration without rebuilding or blocking gameplay.
CREATE INDEX IF NOT EXISTS poker_round_pending_reveal_idx
  ON poker_rounds (game, reveals_at, id) WHERE settled_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS table_rounds_pending_reveal_idx
  ON table_rounds (game_code, reveal_ends_at) WHERE phase <> 'settled';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS table_rounds_venue_end_idx
  ON table_rounds (game_code, client_seed, settle_ends_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS table_rounds_owner_created_idx
  ON table_rounds (game_code, (config->>'owner'), created_at DESC)
  WHERE config->>'owner' IS NOT NULL;
