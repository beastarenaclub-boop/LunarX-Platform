-- Players sign in with a username: "cry" + 4 random digits (e.g. cry4821).
-- Operators (admin/master/agent/support) keep email login.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "username" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_username_idx" ON "users" ("username") WHERE "username" IS NOT NULL;
--> statement-breakpoint
-- Give every existing real player a unique random username. Their old email
-- keeps working as a fallback login so nobody is locked out. Demo and partner
-- shadow accounts never sign in with a password and are skipped.
DO $$
DECLARE
  player record;
  candidate text;
  attempts integer;
BEGIN
  FOR player IN
    SELECT id FROM users
    WHERE role = 'player'
      AND username IS NULL
      AND migrated_to_user_id IS NULL
      AND email_normalized NOT LIKE '%@demo.lunar.local'
      AND email_normalized NOT LIKE '%@partner.lunar.local'
    ORDER BY created_at, id
  LOOP
    candidate := NULL;
    attempts := 0;
    WHILE candidate IS NULL AND attempts < 50 LOOP
      candidate := 'cry' || lpad(floor(random() * 10000)::int::text, 4, '0');
      IF EXISTS (SELECT 1 FROM users WHERE username = candidate OR email_normalized = candidate) THEN
        candidate := NULL;
      END IF;
      attempts := attempts + 1;
    END LOOP;
    IF candidate IS NULL THEN
      SELECT c INTO candidate
      FROM (SELECT 'cry' || lpad(n::text, 4, '0') AS c FROM generate_series(0, 9999) AS n) free
      WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.username = free.c OR u.email_normalized = free.c)
      ORDER BY random()
      LIMIT 1;
    END IF;
    -- All 10,000 usernames are taken: remaining players keep email login.
    EXIT WHEN candidate IS NULL;
    UPDATE users SET username = candidate WHERE id = player.id;
  END LOOP;
END $$;
