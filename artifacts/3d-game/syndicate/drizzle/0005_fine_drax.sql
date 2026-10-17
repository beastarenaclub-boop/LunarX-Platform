CREATE TABLE `entry_sessions` (
	`hash` text PRIMARY KEY NOT NULL,
	`stage` text NOT NULL,
	`key_spot` integer NOT NULL,
	`walk_after` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `entry_expiry` ON `entry_sessions` (`expires_at`);