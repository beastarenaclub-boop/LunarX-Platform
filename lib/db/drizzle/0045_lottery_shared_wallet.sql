CREATE TABLE lottery_settings (
  id integer PRIMARY KEY CHECK (id = 1), version integer NOT NULL DEFAULT 1, value jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE lottery_draws (
  id text PRIMARY KEY, closes bigint NOT NULL, ends bigint NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','settled')),
  seed text NOT NULL, commitment text NOT NULL, results jsonb, config jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX lottery_draw_time_idx ON lottery_draws (ends);
CREATE INDEX lottery_open_draw_idx ON lottery_draws (ends) WHERE status = 'open';
--> statement-breakpoint
CREATE TABLE lottery_tickets (
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), bet_id text NOT NULL REFERENCES bets(id),
  draw_id text NOT NULL REFERENCES lottery_draws(id), game text NOT NULL CHECK (game IN ('2D','3D','Titli')),
  lines jsonb NOT NULL, stake bigint NOT NULL, payout bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','claimed','lost','cancelled')),
  request text NOT NULL, request_hash text NOT NULL, created bigint NOT NULL, claimed bigint,
  CONSTRAINT lottery_ticket_amounts CHECK (stake > 0 AND payout >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX lottery_user_request_idx ON lottery_tickets (user_id, request);
CREATE UNIQUE INDEX lottery_ticket_bet_idx ON lottery_tickets (bet_id);
CREATE INDEX lottery_user_ticket_idx ON lottery_tickets (user_id, created);
CREATE INDEX lottery_draw_ticket_idx ON lottery_tickets (draw_id, status);
--> statement-breakpoint
INSERT INTO game_config (id, game_code, enabled, rtp_min, rtp_max, house_edge, max_multiplier, min_stake_paise, max_stake_paise, settlement_mode)
VALUES ('nice-lottery-config', 'lottery', true, 80, 80, 0.20, 800, 10000, 2000000, 'house_edge')
ON CONFLICT (game_code) DO NOTHING;
