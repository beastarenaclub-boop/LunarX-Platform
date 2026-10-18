-- Weekly collection starts at activation; historical earnings remain in the old ledger.
ALTER TABLE network_nodes ADD COLUMN weekly_started_at timestamptz NOT NULL DEFAULT clock_timestamp();
CREATE TABLE network_websites (
  master_id text PRIMARY KEY REFERENCES network_nodes(id),
  brand_name text,
  logo_data text CHECK (length(logo_data) <= 90000),
  custom_domain text UNIQUE,
  domain_token text NOT NULL,
  domain_status text NOT NULL DEFAULT 'pending' CHECK(domain_status IN ('pending','provisioning','active')),
  provider_domain_id text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE network_weekly_payments (
  id text PRIMARY KEY,
  master_id text NOT NULL REFERENCES network_nodes(id),
  amount bigint NOT NULL CHECK(amount > 0),
  reference text NOT NULL,
  request_id text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','rejected')),
  submitted_by text NOT NULL REFERENCES users(id),
  reviewed_by text REFERENCES users(id),
  review_note text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reviewed_at timestamptz
);
CREATE INDEX network_weekly_payments_master_idx ON network_weekly_payments(master_id,status);
CREATE INDEX network_company_week_idx ON network_ledger(master_id,created_at) WHERE account_kind='company';

-- Signed company commission carries losses/refunds forward. Monday is a 24h grace day.
-- Evaluate on every wager, so downtime or a missed cron can never bypass the lock.
CREATE FUNCTION network_weekly_due(mid text, at_time timestamptz DEFAULT clock_timestamp(), overdue_only boolean DEFAULT true)
RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT greatest(0, COALESCE((SELECT sum(l.amount) FROM network_ledger l
    JOIN network_nodes n ON n.id=l.master_id
    WHERE l.master_id=mid AND l.account_kind='company' AND l.created_at>=n.weekly_started_at
    AND l.created_at < (date_trunc('week', (at_time - CASE WHEN overdue_only THEN interval '1 day' ELSE interval '0 days' END)
      AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')),0)
    - COALESCE((SELECT sum(amount) FROM network_weekly_payments WHERE master_id=mid AND status='confirmed'),0))::bigint
$$;
CREATE FUNCTION network_weekly_wager_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.master_id IS NOT NULL AND network_weekly_due(NEW.master_id)>0 THEN
    RAISE EXCEPTION 'Branch temporarily locked. Contact your account manager.' USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER network_weekly_wager_guard BEFORE INSERT ON network_wagers FOR EACH ROW EXECUTE FUNCTION network_weekly_wager_guard();
-- Bonus/free-bet entries deliberately skip the commission journal, but are still new games.
CREATE FUNCTION network_weekly_bet_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE mid text;
BEGIN
  SELECT a.parent_id INTO mid FROM users u JOIN network_nodes a ON a.id=u.b2b_agent_id WHERE u.id=NEW.user_id;
  IF mid IS NOT NULL AND network_weekly_due(mid)>0 THEN
    RAISE EXCEPTION 'Branch temporarily locked. Contact your account manager.' USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER network_weekly_bet_guard BEFORE INSERT ON bets FOR EACH ROW EXECUTE FUNCTION network_weekly_bet_guard();
CREATE FUNCTION network_weekly_wallet_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE mid text;
BEGIN
  IF NEW.type='bet' AND NEW.amount<0 THEN
    SELECT a.parent_id INTO mid FROM users u JOIN network_nodes a ON a.id=u.b2b_agent_id WHERE u.id=NEW.user_id;
    IF mid IS NOT NULL AND network_weekly_due(mid)>0 THEN
      RAISE EXCEPTION 'Branch temporarily locked. Contact your account manager.' USING ERRCODE='P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER network_weekly_wallet_guard BEFORE INSERT ON wallet_ledger FOR EACH ROW EXECUTE FUNCTION network_weekly_wallet_guard();
CREATE FUNCTION network_weekly_payment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.status<>'pending' THEN RAISE EXCEPTION 'Reviewed weekly payments are immutable'; END IF;
  IF NEW.id<>OLD.id OR NEW.master_id<>OLD.master_id OR NEW.amount<>OLD.amount OR NEW.reference<>OLD.reference
    OR NEW.request_id<>OLD.request_id OR NEW.submitted_by<>OLD.submitted_by OR NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION 'Payment details are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER network_weekly_payment_guard BEFORE UPDATE OR DELETE ON network_weekly_payments FOR EACH ROW EXECUTE FUNCTION network_weekly_payment_guard();
