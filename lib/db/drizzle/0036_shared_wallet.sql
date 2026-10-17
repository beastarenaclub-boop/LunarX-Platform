-- Preserve every ledger entry. Transfer legacy cash balances to one wallet.
-- The surrounding migration transaction makes the switch atomic.
LOCK TABLE wallets, wallet_ledger IN EXCLUSIVE MODE;
--> statement-breakpoint
INSERT INTO wallets (id, user_id, currency, scope)
SELECT 'shared_' || md5(user_id || ':' || currency), user_id, currency, 'lunar'
FROM wallets GROUP BY user_id, currency
ON CONFLICT (user_id, currency, scope) DO NOTHING;
--> statement-breakpoint
DO $$
DECLARE legacy RECORD; target_id text; current_balance bigint;
BEGIN
  FOR legacy IN
    SELECT w.id, w.user_id, w.currency, w.scope, COALESCE(sum(l.amount), 0)::bigint AS balance
    FROM wallets w LEFT JOIN wallet_ledger l ON l.wallet_id = w.id
    WHERE w.scope <> 'lunar' GROUP BY w.id ORDER BY w.user_id, w.id
  LOOP
    IF legacy.balance = 0 THEN CONTINUE; END IF;
    SELECT id INTO target_id FROM wallets
      WHERE user_id = legacy.user_id AND currency = legacy.currency AND scope = 'lunar';
    SELECT COALESCE(sum(amount), 0)::bigint INTO current_balance
      FROM wallet_ledger WHERE wallet_id = target_id;
    INSERT INTO wallet_ledger (id, wallet_id, user_id, type, amount, balance_after, ref_type, ref_id, memo, metadata)
    VALUES
      ('merge_out_' || md5(legacy.id), legacy.id, legacy.user_id, 'adjustment', -legacy.balance, 0,
        'shared_wallet_merge', legacy.id, 'Balance transferred to shared wallet', jsonb_build_object('fromGame', legacy.scope, 'toWallet', target_id)),
      ('merge_in_' || md5(legacy.id), target_id, legacy.user_id, 'adjustment', legacy.balance, current_balance + legacy.balance,
        'shared_wallet_merge', legacy.id, 'Legacy game balance added to shared wallet', jsonb_build_object('fromGame', legacy.scope, 'fromWallet', legacy.id));
  END LOOP;
END $$;
--> statement-breakpoint
-- Old practice slips must never pay into a cash wallet.
ALTER TABLE dragon_tiger_bets ADD COLUMN wallet_funded boolean NOT NULL DEFAULT false;
ALTER TABLE dragon_tiger_bets ALTER COLUMN wallet_funded SET DEFAULT true;
--> statement-breakpoint
ALTER TABLE dragon_tiger_players ALTER COLUMN balance SET DEFAULT 0;
--> statement-breakpoint
CREATE TABLE rummy_sessions (
  user_id text PRIMARY KEY REFERENCES users(id),
  state jsonb NOT NULL,
  version integer NOT NULL DEFAULT 0,
  deadline bigint NOT NULL DEFAULT 0
);
