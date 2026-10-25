CREATE TABLE "ludo_messages" (
  "id" text PRIMARY KEY NOT NULL,
  "match_id" text NOT NULL REFERENCES "ludo_matches"("id"),
  "user_id" text NOT NULL REFERENCES "users"("id"),
  "request_id" text NOT NULL,
  "seat" integer NOT NULL,
  "name" text NOT NULL,
  "kind" text NOT NULL CHECK ("kind" IN ('text', 'emoji')),
  "text" text NOT NULL,
  "emoji_id" text,
  "cost_paise" bigint DEFAULT 0 NOT NULL CHECK ("cost_paise" >= 0),
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ludo_message_request" ON "ludo_messages"("user_id", "request_id");
CREATE INDEX "ludo_messages_match_time" ON "ludo_messages"("match_id", "created_at");
CREATE INDEX "ludo_messages_user_time" ON "ludo_messages"("user_id", "created_at");
