CREATE TABLE "ludo_matches" (
 "id" text PRIMARY KEY NOT NULL, "capacity" integer NOT NULL, "pool" text NOT NULL,
 "status" text NOT NULL, "entry_paise" bigint NOT NULL, "commission_bps" integer NOT NULL,
 "version" integer DEFAULT 0 NOT NULL, "state" jsonb NOT NULL, "seed" text NOT NULL, "commitment" text NOT NULL,
 "deadline" timestamptz NOT NULL, "created_at" timestamptz DEFAULT now() NOT NULL,
 "started_at" timestamptz, "ended_at" timestamptz, "reason" text
);
--> statement-breakpoint
CREATE TABLE "ludo_members" (
 "id" text PRIMARY KEY NOT NULL, "match_id" text NOT NULL REFERENCES "ludo_matches"("id"),
 "user_id" text NOT NULL REFERENCES "users"("id"), "seat" integer NOT NULL,
 "request_id" text NOT NULL, "bet_id" text NOT NULL REFERENCES "bets"("id"),
 "joined_at" timestamptz DEFAULT now() NOT NULL, "ended_at" timestamptz
);
--> statement-breakpoint
CREATE TABLE "ludo_actions" (
 "id" text PRIMARY KEY NOT NULL, "match_id" text NOT NULL REFERENCES "ludo_matches"("id"),
 "user_id" text REFERENCES "users"("id"), "request_id" text, "version" integer NOT NULL,
 "payload" jsonb NOT NULL, "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ludo_due" ON "ludo_matches"("status","deadline");
CREATE INDEX "ludo_queue" ON "ludo_matches"("pool","status","capacity","entry_paise");
CREATE UNIQUE INDEX "ludo_member_request" ON "ludo_members"("user_id","request_id");
CREATE UNIQUE INDEX "ludo_active_user" ON "ludo_members"("user_id") WHERE "ended_at" IS NULL;
CREATE UNIQUE INDEX "ludo_active_seat" ON "ludo_members"("match_id","seat") WHERE "ended_at" IS NULL;
CREATE INDEX "ludo_members_match" ON "ludo_members"("match_id");
CREATE INDEX "ludo_members_user" ON "ludo_members"("user_id","joined_at");
CREATE UNIQUE INDEX "ludo_action_request" ON "ludo_actions"("user_id","request_id");
CREATE UNIQUE INDEX "ludo_action_version" ON "ludo_actions"("match_id","version");
