CREATE TABLE "snake_rooms" (
 "id" text PRIMARY KEY, "pool" text NOT NULL, "code" text, "mode" text NOT NULL, "capacity" integer NOT NULL,
 "status" text NOT NULL, "version" integer DEFAULT 0 NOT NULL, "state" jsonb NOT NULL,
 "deadline" timestamptz NOT NULL, "created_at" timestamptz DEFAULT now() NOT NULL, "ends_at" timestamptz NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "snake_room_code" ON "snake_rooms"("code");
--> statement-breakpoint
CREATE INDEX "snake_queue" ON "snake_rooms"("pool", "status", "mode", "capacity");
--> statement-breakpoint
CREATE TABLE "snake_members" (
 "id" text PRIMARY KEY, "room_id" text NOT NULL REFERENCES "snake_rooms"("id"), "user_id" text NOT NULL REFERENCES "users"("id"),
 "seat" integer NOT NULL, "joined_at" timestamptz DEFAULT now() NOT NULL, "ended_at" timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX "snake_active_user" ON "snake_members"("user_id") WHERE "ended_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "snake_room_members" ON "snake_members"("room_id");
--> statement-breakpoint
CREATE TABLE "snake_requests" (
 "id" text PRIMARY KEY, "user_id" text NOT NULL REFERENCES "users"("id"), "request_id" text NOT NULL,
 "room_id" text NOT NULL REFERENCES "snake_rooms"("id"), "payload" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "snake_user_request" ON "snake_requests"("user_id", "request_id");
