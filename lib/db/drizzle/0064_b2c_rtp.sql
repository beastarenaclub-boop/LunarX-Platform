CREATE TABLE "b2c_rtp_policies" (
  "game_code" text PRIMARY KEY NOT NULL,
  "player_rtp_bps" integer,
  "revision" integer DEFAULT 0 NOT NULL,
  "updated_by" text,
  CONSTRAINT "b2c_rtp_policies_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id"),
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "b2c_rtp_range_check" CHECK ("player_rtp_bps" IS NULL OR "player_rtp_bps" BETWEEN 100 AND 10000),
  CONSTRAINT "b2c_rtp_revision_check" CHECK ("revision" >= 0)
);
