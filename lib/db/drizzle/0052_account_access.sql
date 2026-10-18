ALTER TABLE sessions ADD COLUMN last_seen_at timestamptz;
ALTER TABLE sessions ADD COLUMN last_ip text;
ALTER TABLE sessions ADD COLUMN client_hints jsonb;
CREATE INDEX sessions_activity_idx ON sessions (COALESCE(last_seen_at, created_at) DESC);
