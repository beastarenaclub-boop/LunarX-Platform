ALTER TABLE users ADD COLUMN channel text NOT NULL DEFAULT 'b2c' CHECK (channel IN ('b2c','b2b'));
ALTER TABLE users ADD COLUMN b2b_agent_id text;
CREATE TABLE network_nodes (
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('master','agent')),
  parent_id text REFERENCES network_nodes(id), name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  company_fee_bps integer NOT NULL DEFAULT 1000 CHECK (company_fee_bps BETWEEN 0 AND 10000),
  share_bps integer NOT NULL DEFAULT 10000 CHECK (share_bps BETWEEN 0 AND 10000),
  created_by text NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'master' AND parent_id IS NULL) OR (kind = 'agent' AND parent_id IS NOT NULL))
);
CREATE UNIQUE INDEX network_user_idx ON network_nodes(user_id);
CREATE INDEX network_parent_idx ON network_nodes(parent_id);
ALTER TABLE users ADD CONSTRAINT users_b2b_agent_fk FOREIGN KEY (b2b_agent_id) REFERENCES network_nodes(id);
ALTER TABLE users ADD CONSTRAINT users_channel_owner CHECK
  ((channel = 'b2c' AND b2b_agent_id IS NULL) OR (channel = 'b2b' AND role = 'player' AND b2b_agent_id IS NOT NULL));
CREATE INDEX users_channel_agent_idx ON users(channel, b2b_agent_id);

CREATE TABLE network_wagers (
  source text NOT NULL, source_id text NOT NULL, user_id text NOT NULL REFERENCES users(id),
  game_code text NOT NULL, channel text NOT NULL, master_id text REFERENCES network_nodes(id),
  agent_id text REFERENCES network_nodes(id), terms jsonb NOT NULL,
  stake bigint NOT NULL DEFAULT 0, payout bigint NOT NULL DEFAULT 0, settled boolean NOT NULL DEFAULT false,
  company_amount bigint NOT NULL DEFAULT 0, master_amount bigint NOT NULL DEFAULT 0, agent_amount bigint NOT NULL DEFAULT 0,
  revision integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), settled_at timestamptz,
  PRIMARY KEY(source, source_id)
);
CREATE INDEX network_wagers_user_idx ON network_wagers(user_id);
CREATE INDEX network_wagers_branch_idx ON network_wagers(master_id, agent_id);
CREATE TABLE network_ledger (
  id bigserial PRIMARY KEY, source text NOT NULL, source_id text NOT NULL, revision integer NOT NULL,
  user_id text NOT NULL REFERENCES users(id), game_code text NOT NULL, channel text NOT NULL,
  master_id text REFERENCES network_nodes(id), agent_id text REFERENCES network_nodes(id),
  account_id text NOT NULL, account_kind text NOT NULL CHECK (account_kind IN ('company','master','agent')),
  amount bigint NOT NULL, gross_stake bigint NOT NULL, gross_payout bigint NOT NULL, terms jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(source, source_id, revision, account_id)
);
CREATE INDEX network_ledger_account_idx ON network_ledger(account_id, created_at);
CREATE INDEX network_ledger_channel_idx ON network_ledger(channel, created_at);
CREATE TABLE network_settlements (
  id text PRIMARY KEY, node_id text NOT NULL REFERENCES network_nodes(id), amount bigint NOT NULL CHECK(amount <> 0),
  reference text NOT NULL, request_id text NOT NULL UNIQUE, created_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION network_validate_node() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.kind <> OLD.kind OR NEW.parent_id IS DISTINCT FROM OLD.parent_id OR
      NEW.user_id <> OLD.user_id OR NEW.company_fee_bps <> OLD.company_fee_bps) THEN
    RAISE EXCEPTION 'Branch ownership and company fee are permanent';
  END IF;
  IF NEW.kind = 'agent' AND NOT EXISTS(SELECT 1 FROM network_nodes WHERE id = NEW.parent_id AND kind = 'master') THEN
    RAISE EXCEPTION 'An agent must belong to a master';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER network_validate_node BEFORE INSERT OR UPDATE ON network_nodes FOR EACH ROW EXECUTE FUNCTION network_validate_node();
CREATE FUNCTION network_validate_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.channel <> OLD.channel OR NEW.b2b_agent_id IS DISTINCT FROM OLD.b2b_agent_id) THEN
    RAISE EXCEPTION 'Player channel and agent ownership are permanent';
  END IF;
  IF NEW.channel = 'b2b' AND NOT EXISTS(SELECT 1 FROM network_nodes WHERE id = NEW.b2b_agent_id AND kind = 'agent') THEN
    RAISE EXCEPTION 'B2B players must belong to an agent';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER network_validate_owner BEFORE INSERT OR UPDATE ON users FOR EACH ROW EXECUTE FUNCTION network_validate_owner();

-- One snapshot per accepted wager. Existing wagers are intentionally not backfilled.
CREATE FUNCTION network_open_wager(src text, ref text, uid text, game text, amount bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE u users%ROWTYPE; a network_nodes%ROWTYPE; m network_nodes%ROWTYPE; t jsonb;
BEGIN
  SELECT * INTO u FROM users WHERE id = uid;
  IF NOT FOUND OR u.role <> 'player' OR u.email LIKE '%@demo.lunar.local' THEN RETURN; END IF;
  IF u.channel = 'b2b' THEN
    SELECT * INTO a FROM network_nodes WHERE id = u.b2b_agent_id;
    SELECT * INTO m FROM network_nodes WHERE id = a.parent_id;
    IF a.id IS NULL OR m.id IS NULL THEN RAISE EXCEPTION 'Missing B2B ownership'; END IF;
    IF a.status <> 'active' OR m.status <> 'active' THEN RAISE EXCEPTION 'Branch is suspended'; END IF;
    t := jsonb_build_object('companyFeeBps',m.company_fee_bps,'masterShareBps',m.share_bps,'agentShareBps',a.share_bps);
  ELSE t := jsonb_build_object('companyFeeBps',10000,'masterShareBps',0,'agentShareBps',0); END IF;
  INSERT INTO network_wagers(source, source_id, user_id, game_code, channel, master_id, agent_id, terms, stake)
    VALUES(src,ref,uid,game,u.channel,m.id,a.id,t,amount) ON CONFLICT DO NOTHING;
END $$;

CREATE FUNCTION network_close_wager(src text, ref text, amount bigint, returned bigint, done boolean) RETURNS void LANGUAGE plpgsql AS $$
DECLARE w network_wagers%ROWTYPE; net bigint; fee bigint; pool_amount bigint; c bigint; m bigint; a bigint;
  ds bigint; dp bigint; rev integer;
BEGIN
  SELECT * INTO w FROM network_wagers WHERE source = src AND source_id = ref FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF w.settled = done AND w.stake = amount AND w.payout = returned THEN RETURN; END IF;
  net := CASE WHEN done THEN amount-returned ELSE 0 END;
  fee := trunc(net::numeric * (w.terms->>'companyFeeBps')::integer / 10000)::bigint;
  pool_amount := trunc((net-fee)::numeric * (w.terms->>'masterShareBps')::integer / 10000)::bigint;
  a := trunc(pool_amount::numeric * (w.terms->>'agentShareBps')::integer / 10000)::bigint;
  m := pool_amount-a; c := net-pool_amount; rev := w.revision+1;
  ds := (CASE WHEN done THEN amount ELSE 0 END) - (CASE WHEN w.settled THEN w.stake ELSE 0 END);
  dp := (CASE WHEN done THEN returned ELSE 0 END) - (CASE WHEN w.settled THEN w.payout ELSE 0 END);
  IF done OR w.settled THEN
    INSERT INTO network_ledger(source,source_id,revision,user_id,game_code,channel,master_id,agent_id,account_id,account_kind,amount,gross_stake,gross_payout,terms)
    VALUES(src,ref,rev,w.user_id,w.game_code,w.channel,w.master_id,w.agent_id,'company','company',c-w.company_amount,ds,dp,w.terms);
    IF w.channel = 'b2b' THEN
      INSERT INTO network_ledger(source,source_id,revision,user_id,game_code,channel,master_id,agent_id,account_id,account_kind,amount,gross_stake,gross_payout,terms)
      VALUES(src,ref,rev,w.user_id,w.game_code,w.channel,w.master_id,w.agent_id,w.master_id,'master',m-w.master_amount,ds,dp,w.terms),
            (src,ref,rev,w.user_id,w.game_code,w.channel,w.master_id,w.agent_id,w.agent_id,'agent',a-w.agent_amount,ds,dp,w.terms);
    END IF;
  END IF;
  UPDATE network_wagers SET stake=amount,payout=returned,settled=done,company_amount=c,master_amount=m,agent_amount=a,
    revision=rev,settled_at=CASE WHEN done THEN now() ELSE NULL END WHERE source=src AND source_id=ref;
END $$;

-- All shared-wallet games: the common bet table plus the games with independent bet stores.
CREATE FUNCTION network_capture_game() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE j jsonb := to_jsonb(NEW); ref text := j->>'id'; uid text := j->>'user_id';
  game text; stake bigint; payout bigint; done boolean; is_new boolean := TG_OP = 'INSERT';
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'bets' THEN
      IF j->>'partner_id' IS NOT NULL OR COALESCE((j#>>'{metadata,freeBet}')::boolean,false) OR COALESCE((j#>>'{metadata,useBonus}')::boolean,false) THEN RETURN NEW; END IF;
      game:=j->>'game_code'; stake:=(j->>'stake_amount')::bigint; payout:=(j->>'payout_amount')::bigint;
      done:=j->>'status' IN ('won','lost','cashed_out','voided');
      IF j->>'status' = 'voided' THEN stake:=0; payout:=0; END IF;
    WHEN 'dragon_tiger_bets' THEN
      IF NOT (j->>'wallet_funded')::boolean THEN RETURN NEW; END IF;
      game:='dragon-tiger'; stake:=(j->>'stake')::bigint*100; payout:=((j->>'payout')::numeric*100)::bigint; done:=payout IS NOT NULL;
    WHEN 'dragon_tiger_one_day_bets' THEN
      game:='dragon-tiger-one-day'; stake:=(j->>'stake_paise')::bigint; payout:=(j->>'payout_paise')::bigint; done:=payout IS NOT NULL;
    WHEN 'wingo_bets' THEN
      game:='wingo'; stake:=(j->>'stake')::bigint; payout:=(j->>'payout')::bigint; done:=payout IS NOT NULL;
    WHEN 'forex_trades' THEN
      game:='forex-trading'; stake:=(j->>'amount')::bigint; payout:=(j->>'payout')::bigint; done:=j->>'status' <> 'open';
    WHEN 'virtual_sports_bets' THEN
      game:='virtual-sports'; stake:=(j->>'amount')::bigint; payout:=(j->>'payout')::bigint; done:=j->>'status' <> 'pending';
    WHEN 'rummy_sessions' THEN
      game:='rummy'; ref:=uid||':'||(j#>>'{state,table,round}');
      stake:=(j#>>'{state,table,stake}')::bigint*100;
      IF COALESCE(stake,0) <= 0 OR (j#>>'{state,table,round}')::integer <= 0 THEN RETURN NEW; END IF;
      IF TG_OP = 'UPDATE' THEN is_new := (to_jsonb(OLD)#>>'{state,table,round}') IS DISTINCT FROM (j#>>'{state,table,round}'); END IF;
      payout:=COALESCE((j#>>'{state,table,result,payout}')::bigint*100,0); done:=j#>>'{state,table,phase}'='finished';
    ELSE RETURN NEW;
  END CASE;
  IF is_new THEN PERFORM network_open_wager(TG_TABLE_NAME,ref,uid,game,stake); END IF;
  PERFORM network_close_wager(TG_TABLE_NAME,ref,stake,COALESCE(payout,0),done);
  RETURN NEW;
END $$;
CREATE TRIGGER network_capture AFTER INSERT OR UPDATE ON bets FOR EACH ROW EXECUTE FUNCTION network_capture_game();
CREATE TRIGGER network_capture AFTER INSERT OR UPDATE ON dragon_tiger_bets FOR EACH ROW EXECUTE FUNCTION network_capture_game();
CREATE TRIGGER network_capture AFTER INSERT OR UPDATE ON dragon_tiger_one_day_bets FOR EACH ROW EXECUTE FUNCTION network_capture_game();
CREATE TRIGGER network_capture AFTER INSERT OR UPDATE ON wingo_bets FOR EACH ROW EXECUTE FUNCTION network_capture_game();
CREATE TRIGGER network_capture AFTER INSERT OR UPDATE ON forex_trades FOR EACH ROW EXECUTE FUNCTION network_capture_game();
CREATE TRIGGER network_capture AFTER INSERT OR UPDATE ON virtual_sports_bets FOR EACH ROW EXECUTE FUNCTION network_capture_game();
CREATE TRIGGER network_capture AFTER INSERT OR UPDATE ON rummy_sessions FOR EACH ROW EXECUTE FUNCTION network_capture_game();

CREATE FUNCTION network_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Network ledger is append-only'; END $$;
CREATE TRIGGER network_ledger_immutable BEFORE UPDATE OR DELETE ON network_ledger FOR EACH ROW EXECUTE FUNCTION network_append_only();
CREATE TRIGGER network_settlements_immutable BEFORE UPDATE OR DELETE ON network_settlements FOR EACH ROW EXECUTE FUNCTION network_append_only();

CREATE FUNCTION network_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source <> OLD.source OR NEW.source_id <> OLD.source_id OR NEW.user_id <> OLD.user_id
    OR NEW.channel <> OLD.channel OR NEW.master_id IS DISTINCT FROM OLD.master_id
    OR NEW.agent_id IS DISTINCT FROM OLD.agent_id OR NEW.terms <> OLD.terms THEN
    RAISE EXCEPTION 'Wager ownership and commission snapshot are permanent';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER network_snapshot_immutable BEFORE UPDATE ON network_wagers FOR EACH ROW EXECUTE FUNCTION network_snapshot_immutable();
