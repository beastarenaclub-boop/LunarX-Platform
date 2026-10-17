CREATE TABLE "partner_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"partner_id" text NOT NULL,
	"player_ref" text NOT NULL,
	"game_code" text NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"wrapper_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "partner_id" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "partner_player_ref" text;--> statement-breakpoint
ALTER TABLE "partner_sessions" ADD CONSTRAINT "partner_sessions_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "partner_sessions_token_idx" ON "partner_sessions" USING btree ("token");--> statement-breakpoint
CREATE INDEX "partner_sessions_partner_id_idx" ON "partner_sessions" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "partner_sessions_expires_at_idx" ON "partner_sessions" USING btree ("expires_at");