CREATE TABLE IF NOT EXISTS "lobby_layout" (
  "id" text PRIMARY KEY NOT NULL,
  "revision" integer DEFAULT 0 NOT NULL,
  "layout" jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by" text
);
