ALTER TABLE "mines_rounds" ADD COLUMN "payout_version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "mines_rounds" ALTER COLUMN "payout_version" SET DEFAULT 2;
