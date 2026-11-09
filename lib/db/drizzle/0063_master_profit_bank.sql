CREATE TABLE network_bank_entries (
 id text PRIMARY KEY, master_id text NOT NULL REFERENCES network_nodes(id), kind text NOT NULL,
 amount bigint NOT NULL, balance_after bigint NOT NULL, request_id text NOT NULL UNIQUE,
 created_by text NOT NULL REFERENCES users(id), settlement_id text REFERENCES network_settlements(id),
 details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT network_bank_amount_check CHECK ((kind='reserve' AND amount>0) OR (kind IN ('return','distribute') AND amount<0)),
 CONSTRAINT network_bank_balance_check CHECK (balance_after>=0)
);
CREATE INDEX network_bank_master_idx ON network_bank_entries(master_id,created_at);
CREATE UNIQUE INDEX network_bank_settlement_idx ON network_bank_entries(settlement_id);
CREATE TABLE network_profit_distributions (
 id text PRIMARY KEY REFERENCES network_bank_entries(id), cutoff_at timestamptz NOT NULL,
 total_stake bigint NOT NULL, recipient_count integer NOT NULL, preview_hash text NOT NULL,
 CONSTRAINT network_profit_distribution_check CHECK (total_stake>0 AND recipient_count>0)
);
CREATE TABLE network_profit_recipients (
 distribution_id text NOT NULL REFERENCES network_profit_distributions(id), user_id text NOT NULL REFERENCES users(id),
 stake bigint NOT NULL, amount bigint NOT NULL, wallet_entry_id text REFERENCES wallet_ledger(id),
 PRIMARY KEY(distribution_id,user_id),
 CONSTRAINT network_profit_recipient_check CHECK (stake>0 AND amount>=0 AND ((amount=0 AND wallet_entry_id IS NULL) OR (amount>0 AND wallet_entry_id IS NOT NULL)))
);
CREATE UNIQUE INDEX network_profit_wallet_entry_idx ON network_profit_recipients(wallet_entry_id);
