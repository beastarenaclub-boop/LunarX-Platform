CREATE TABLE `admin_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_by` text,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_invitations_token_hash_unique` ON `admin_invitations` (`token_hash`);--> statement-breakpoint
ALTER TABLE `login_accounts` ADD `signup_portal` text DEFAULT 'member' NOT NULL;