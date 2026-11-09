CREATE TYPE "public"."rummy_round_status" AS ENUM('active', 'won', 'lost', 'drawn');
--> statement-breakpoint
CREATE TABLE "engine_bank_budget" (
	"scope" text PRIMARY KEY NOT NULL,
	"mode" text DEFAULT 'per_game' NOT NULL,
	"floor_paise" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);

--> statement-breakpoint
CREATE TABLE "game_bank_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"stream_key" text NOT NULL,
	"game_code" text NOT NULL,
	"round_id" text NOT NULL,
	"type" text NOT NULL,
	"delta_paise" bigint NOT NULL,
	"balance_after_paise" bigint NOT NULL,
	"total_stakes_paise" bigint DEFAULT 0 NOT NULL,
	"total_payouts_paise" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE "game_engine_config" (
	"stream_key" text PRIMARY KEY NOT NULL,
	"game_code" text NOT NULL,
	"partner_id" text,
	"mode" text DEFAULT 'normal' NOT NULL,
	"params" jsonb,
	"bank_paise" bigint DEFAULT 0 NOT NULL,
	"min_bank_floor_paise" bigint DEFAULT 0 NOT NULL,
	"zero_bet_streak" integer DEFAULT 0 NOT NULL,
	"beneficiary_streak" integer DEFAULT 0 NOT NULL,
	"last_beneficiary_user_id" text,
	"recent_pockets" jsonb,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE "pending_wins" (
	"user_id" text NOT NULL,
	"game_code" text NOT NULL,
	"partner_id" text,
	"amount_paise" bigint DEFAULT 0 NOT NULL,
	"round_id" text,
	"last_won_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_take_amount_paise" bigint DEFAULT 0 NOT NULL,
	"last_take_key" text,
	"last_taken_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pending_wins_user_id_game_code_pk" PRIMARY KEY("user_id","game_code")
);

--> statement-breakpoint
CREATE TABLE "round_decision" (
	"id" text PRIMARY KEY NOT NULL,
	"round_id" text NOT NULL,
	"stream_key" text NOT NULL,
	"game_code" text NOT NULL,
	"mode" text NOT NULL,
	"winning_pocket" integer,
	"winning_choice" text,
	"house_delta_paise" bigint DEFAULT 0 NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "round_decision_round_id_unique" UNIQUE("round_id")
);

--> statement-breakpoint
CREATE TABLE "rummy_rounds" (
	"id" text PRIMARY KEY NOT NULL,
	"bet_id" text NOT NULL,
	"user_id" text NOT NULL,
	"stream_key" text NOT NULL,
	"stake_paise" bigint NOT NULL,
	"server_seed" text NOT NULL,
	"server_seed_hash" text NOT NULL,
	"client_seed" text NOT NULL,
	"nonce" bigint NOT NULL,
	"deal" jsonb NOT NULL,
	"result_source" text NOT NULL,
	"predicted_class" text,
	"state" jsonb NOT NULL,
	"status" "rummy_round_status" DEFAULT 'active' NOT NULL,
	"turn_deadline" timestamp with time zone,
	"winner" integer,
	"reason" text,
	"points" jsonb,
	"payout_amount" bigint,
	"multiplier" double precision,
	"house_edge" double precision NOT NULL,
	"max_multiplier" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "rummy_rounds_bet_id_unique" UNIQUE("bet_id")
);

--> statement-breakpoint
ALTER TABLE "game_config" ADD COLUMN "ft_digit_return" double precision DEFAULT 9 NOT NULL;
--> statement-breakpoint
ALTER TABLE "game_config" ADD COLUMN "max_per_spot_paise" bigint DEFAULT 500000 NOT NULL;
--> statement-breakpoint
ALTER TABLE "table_round_bets" ADD COLUMN "idempotency_key" text;
--> statement-breakpoint
ALTER TABLE "table_rounds" ADD COLUMN "partner_id" text;
--> statement-breakpoint
ALTER TABLE "table_rounds" ADD COLUMN "result_source" text DEFAULT 'drawn' NOT NULL;
--> statement-breakpoint
ALTER TABLE "game_engine_config" ADD CONSTRAINT "game_engine_config_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "game_engine_config" ADD CONSTRAINT "game_engine_config_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pending_wins" ADD CONSTRAINT "pending_wins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pending_wins" ADD CONSTRAINT "pending_wins_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "rummy_rounds" ADD CONSTRAINT "rummy_rounds_bet_id_bets_id_fk" FOREIGN KEY ("bet_id") REFERENCES "public"."bets"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "rummy_rounds" ADD CONSTRAINT "rummy_rounds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "game_bank_ledger_round_type_idx" ON "game_bank_ledger" USING btree ("round_id","type");
--> statement-breakpoint
CREATE INDEX "game_bank_ledger_stream_created_idx" ON "game_bank_ledger" USING btree ("stream_key","created_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "game_engine_config_game_idx" ON "game_engine_config" USING btree ("game_code");
--> statement-breakpoint
CREATE INDEX "pending_wins_last_won_at_idx" ON "pending_wins" USING btree ("last_won_at") WHERE "pending_wins"."amount_paise" > 0;
--> statement-breakpoint
CREATE INDEX "round_decision_stream_created_idx" ON "round_decision" USING btree ("stream_key","created_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "rummy_rounds_user_id_idx" ON "rummy_rounds" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "rummy_rounds_created_at_idx" ON "rummy_rounds" USING btree ("created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "rummy_rounds_one_active_per_user_idx" ON "rummy_rounds" USING btree ("user_id") WHERE "rummy_rounds"."status" = 'active';
--> statement-breakpoint
CREATE UNIQUE INDEX "table_slip_idempotency_idx" ON "table_round_bets" USING btree ("user_id","idempotency_key");
