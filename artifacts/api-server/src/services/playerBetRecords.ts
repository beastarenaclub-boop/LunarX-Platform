import { sql, type SQL } from "drizzle-orm";
// Select only the player's financial records. Round seeds, cards and future
// outcomes are deliberately absent, including while a round is still open.
export function playerBetRecords(userId: string | SQL) {
  return sql`
    SELECT 'bet:' || b.id AS id, b.placed_at AS at, b.game_code AS game, b.round_id::text AS reference,
      b.stake_amount::text AS stake, b.payout_amount::text AS payout, b.status::text AS status
      FROM bets b WHERE b.user_id = ${userId}
    UNION ALL SELECT 'wingo:' || b.id, to_timestamp(b.created / 1000.0), 'wingo', b.period::text,
      b.stake::text, b.payout::text, CASE WHEN b.payout IS NULL THEN 'placed' WHEN b.payout > 0 THEN 'won' ELSE 'lost' END
      FROM wingo_bets b WHERE b.user_id = ${userId}
    UNION ALL SELECT 'forex:' || b.id, to_timestamp(b.opened / 1000.0), 'forex-trading', b.round_id::text,
      b.amount::text, b.payout::text, CASE b.status WHEN 'open' THEN 'placed' WHEN 'refund' THEN 'voided' ELSE b.status END
      FROM forex_trades b WHERE b.user_id = ${userId}
    UNION ALL SELECT 'sports:' || b.id, to_timestamp(b.created / 1000.0), 'virtual-' || b.sport, b.round_id,
      b.amount::text, b.payout::text, CASE b.status WHEN 'pending' THEN 'placed' ELSE b.status END
      FROM virtual_sports_bets b WHERE b.user_id = ${userId}
    UNION ALL SELECT 'dt:' || b.id, COALESCE(l.created_at, r.closes_at), 'dragon-tiger', b.round_id::text,
      (b.stake::bigint * 100)::text, (b.payout * 100)::bigint::text,
      CASE WHEN b.payout IS NULL THEN 'placed' WHEN b.payout > 0 THEN 'won' ELSE 'lost' END
      FROM dragon_tiger_bets b JOIN dragon_tiger_rounds r ON r.id = b.round_id
      LEFT JOIN LATERAL (SELECT created_at FROM wallet_ledger WHERE user_id = ${userId} AND ref_type = 'dragon_tiger_bet' AND ref_id = b.round_id::text || ':' || b.user_id ORDER BY created_at LIMIT 1) l ON true
      WHERE b.user_id = ${userId} AND b.wallet_funded = true
    UNION ALL SELECT 'dtday:' || b.id, COALESCE(l.created_at, CASE b.stage WHEN 'first' THEN r.first_closes_at ELSE r.second_closes_at END), 'dragon-tiger-one-day', b.round_id::text,
      b.stake_paise::text, b.payout_paise::text, CASE WHEN b.payout_paise IS NULL THEN 'placed' WHEN b.payout_paise > 0 THEN 'won' ELSE 'lost' END
      FROM dragon_tiger_one_day_bets b JOIN dragon_tiger_one_day_rounds r ON r.id = b.round_id
      LEFT JOIN LATERAL (SELECT created_at FROM wallet_ledger WHERE user_id = ${userId} AND ref_type = 'dt_one_day_bet' AND ref_id = b.round_id::text || ':' || b.stage || ':' || b.user_id ORDER BY created_at LIMIT 1) l ON true
      WHERE b.user_id = ${userId}
    UNION ALL SELECT 'rummy:' || l.id, l.created_at, 'rummy', l.ref_id, (-l.amount)::text, paid.amount::text,
      CASE WHEN s.user_id IS NOT NULL AND s.state->'table'->>'phase' <> 'finished' THEN 'placed' WHEN COALESCE(paid.amount, 0) > 0 THEN 'won' ELSE 'lost' END
      FROM wallet_ledger l
      LEFT JOIN LATERAL (SELECT amount FROM wallet_ledger WHERE user_id = ${userId} AND ref_type = 'rummy_payout' AND ref_id = l.ref_id LIMIT 1) paid ON true
      LEFT JOIN rummy_sessions s ON s.user_id = l.user_id AND l.ref_id = s.user_id || ':' || (s.state->'table'->>'round')
      WHERE l.user_id = ${userId} AND l.ref_type = 'rummy_bet' AND l.amount < 0
    UNION ALL SELECT 'poker:' || b.id, b.created_at, r.game, b.round_id::text,
      b.stake_paise::text, b.payout_paise::text,
      CASE WHEN b.payout_paise IS NULL THEN 'placed' WHEN b.payout_paise > 0 THEN 'won' ELSE 'lost' END
      FROM poker_bets b JOIN poker_rounds r ON r.id = b.round_id WHERE b.user_id = ${userId}
  `;
}
