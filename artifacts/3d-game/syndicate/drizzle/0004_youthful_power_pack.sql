CREATE TABLE `location_sessions` (
	`hash` text PRIMARY KEY NOT NULL,
	`identity` text NOT NULL,
	`location` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `login_sessions` ADD `location` text;