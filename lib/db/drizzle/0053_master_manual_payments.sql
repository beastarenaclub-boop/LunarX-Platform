CREATE TABLE "master_payment_accounts" (
  "master_id" text PRIMARY KEY CONSTRAINT "master_payment_accounts_master_id_network_nodes_id_fk" REFERENCES "network_nodes"("id"),
  "label" text NOT NULL,
  "upi_id" text NOT NULL,
  "qr_data" text,
  "active" boolean DEFAULT true NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_requests" ADD COLUMN "collection_master_id" text CONSTRAINT "payment_requests_collection_master_id_network_nodes_id_fk" REFERENCES "network_nodes"("id");
--> statement-breakpoint
ALTER TABLE "payment_requests" ADD COLUMN "collection_account_version" integer;
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_requests_master_utr_idx" ON "payment_requests" ("collection_master_id", lower("upi_ref")) WHERE "collection_master_id" IS NOT NULL AND "kind" = 'deposit' AND "method" = 'manual';
