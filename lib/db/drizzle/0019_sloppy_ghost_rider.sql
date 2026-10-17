CREATE TABLE "company_profit_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"settlement_id" text NOT NULL,
	"game_code" text NOT NULL,
	"amount" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_profit_ledger" ADD CONSTRAINT "company_profit_ledger_settlement_id_round_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."round_settlements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cpl_settlement_unique_idx" ON "company_profit_ledger" USING btree ("settlement_id");--> statement-breakpoint
CREATE INDEX "cpl_game_code_idx" ON "company_profit_ledger" USING btree ("game_code");--> statement-breakpoint
CREATE INDEX "cpl_created_at_idx" ON "company_profit_ledger" USING btree ("created_at");