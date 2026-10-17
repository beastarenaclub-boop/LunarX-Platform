ALTER TABLE "partners" DROP COLUMN IF EXISTS "rtp_override";--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "rtp_overrides" jsonb;--> statement-breakpoint
ALTER TABLE "partner_api_keys" ADD COLUMN IF NOT EXISTS "secret" text DEFAULT '' NOT NULL;--> statement-breakpoint
-- Auth scheme moved from bcrypt(secret_hash) → AES-256-GCM encrypted
-- `secret` for server-side HMAC verification. Pre-existing keys cannot
-- be backfilled (their plaintext is unrecoverable from the bcrypt
-- hash), so we proactively revoke every key whose `secret` is still
-- empty. Operators must rotate (POST
-- /admin/partners/:id/api-keys/:keyId/rotate) to restore traffic, which
-- also disambiguates "key was never migrated" from "key is legitimately
-- empty" at runtime.
UPDATE "partner_api_keys"
   SET "status" = 'revoked',
       "revoked_at" = COALESCE("revoked_at", now())
 WHERE "secret" = '' AND "status" = 'active';--> statement-breakpoint
-- secret_hash was the bcrypt-of-secret used by the old auth path. The new
-- HMAC verifier needs the recoverable secret (now stored encrypted in the
-- `secret` column above), so secret_hash is dead weight and would also
-- force every issuance/rotation to write a placeholder. Drop it.
ALTER TABLE "partner_api_keys" DROP COLUMN IF EXISTS "secret_hash";--> statement-breakpoint
-- Add the FKs the schema declares for partner-tagged bets/rounds. ON
-- DELETE SET NULL because deleting a partner shouldn't cascade-destroy
-- historical bet/round audit rows.
DO $$ BEGIN
 ALTER TABLE "bets" ADD CONSTRAINT "bets_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "game_rounds" ADD CONSTRAINT "game_rounds_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_delivery_attempts" (
        "id" text PRIMARY KEY NOT NULL,
        "delivery_id" text NOT NULL,
        "attempt_number" integer NOT NULL,
        "status_code" integer NOT NULL,
        "response_body" text,
        "request_headers" jsonb,
        "request_body" text,
        "error_message" text,
        "duration_ms" integer DEFAULT 0 NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "webhook_delivery_attempts" ADD CONSTRAINT "webhook_delivery_attempts_delivery_id_webhook_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."webhook_deliveries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_delivery_attempts_delivery_id_idx" ON "webhook_delivery_attempts" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_delivery_attempts_created_at_idx" ON "webhook_delivery_attempts" USING btree ("created_at");
