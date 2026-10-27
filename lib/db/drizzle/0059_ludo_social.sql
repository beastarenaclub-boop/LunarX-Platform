CREATE TABLE "ludo_profiles" (
 "user_id" text PRIMARY KEY REFERENCES "users"("id"), "friend_code" text NOT NULL,
 "seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ludo_friend_code" ON "ludo_profiles"("friend_code");
--> statement-breakpoint
CREATE TABLE "ludo_friendships" (
 "id" text PRIMARY KEY, "left_id" text NOT NULL REFERENCES "users"("id"), "right_id" text NOT NULL REFERENCES "users"("id"),
 "requested_by" text NOT NULL REFERENCES "users"("id"), "status" text NOT NULL,
 "left_blocked" boolean DEFAULT false NOT NULL, "right_blocked" boolean DEFAULT false NOT NULL,
 "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ludo_friend_pair" ON "ludo_friendships"("left_id", "right_id");
--> statement-breakpoint
CREATE INDEX "ludo_friend_left" ON "ludo_friendships"("left_id");
--> statement-breakpoint
CREATE INDEX "ludo_friend_right" ON "ludo_friendships"("right_id");
--> statement-breakpoint
CREATE TABLE "ludo_direct_messages" (
 "id" text PRIMARY KEY, "friendship_id" text NOT NULL REFERENCES "ludo_friendships"("id"),
 "sender_id" text NOT NULL REFERENCES "users"("id"), "request_id" text NOT NULL,
 "kind" text NOT NULL, "text" text NOT NULL, "room_code" text,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ludo_dm_request" ON "ludo_direct_messages"("sender_id", "request_id");
--> statement-breakpoint
CREATE INDEX "ludo_dm_thread" ON "ludo_direct_messages"("friendship_id", "created_at");
