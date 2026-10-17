ALTER TYPE "public"."bonus_event_type" ADD VALUE 'bonus_credit_failed';--> statement-breakpoint
ALTER TABLE "referrals" ADD COLUMN "reward_paise" bigint DEFAULT 0 NOT NULL;