ALTER TABLE "network_nodes" ADD COLUMN "player_rtp_bps" integer;
ALTER TABLE "network_nodes" ADD COLUMN "rtp_revision" integer DEFAULT 0 NOT NULL;
ALTER TABLE "network_nodes" ADD CONSTRAINT "network_master_rtp_check"
  CHECK ("player_rtp_bps" IS NULL OR ("kind" = 'master' AND "player_rtp_bps" BETWEEN 100 AND 10000));
ALTER TABLE "network_nodes" ADD CONSTRAINT "network_rtp_revision_check" CHECK ("rtp_revision" >= 0);
ALTER TABLE "table_round_bets" ADD COLUMN "pricing_config" jsonb;
ALTER TABLE "wingo_bets" ADD COLUMN "return_bps" integer;
ALTER TABLE "wingo_bets" ADD COLUMN "pricing_version" text;
