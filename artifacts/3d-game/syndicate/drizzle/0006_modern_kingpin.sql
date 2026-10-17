CREATE TABLE `visitor_checkins` (
	`id` text PRIMARY KEY NOT NULL,
	`session_hash` text NOT NULL,
	`name` text NOT NULL,
	`object_key` text NOT NULL,
	`size` integer NOT NULL,
	`ip` text NOT NULL,
	`country` text,
	`city` text,
	`location` text NOT NULL,
	`user_agent` text NOT NULL,
	`consent_version` text NOT NULL,
	`consent_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `visitor_checkins_session_hash_unique` ON `visitor_checkins` (`session_hash`);--> statement-breakpoint
CREATE INDEX `visitor_created` ON `visitor_checkins` (`created_at`);--> statement-breakpoint
CREATE TABLE `visitor_sessions` (
	`hash` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL
);
