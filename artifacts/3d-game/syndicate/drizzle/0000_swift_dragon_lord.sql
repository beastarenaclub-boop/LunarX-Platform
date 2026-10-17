CREATE TABLE `audit` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`subject` text NOT NULL,
	`detail` text NOT NULL,
	`ip` text NOT NULL,
	`country` text,
	`city` text,
	`location` text,
	`user_agent` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_actor_date` ON `audit` (`actor`,`created_at`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`object_key` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_kind` ON `documents` (`member_id`,`kind`);--> statement-breakpoint
CREATE TABLE `entries` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`account_id` text,
	`kind` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`reference` text NOT NULL,
	`description` text NOT NULL,
	`date` text NOT NULL,
	`status` text DEFAULT 'Pending' NOT NULL,
	`source` text NOT NULL,
	`created_by` text NOT NULL,
	`reviewed_by` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entries_reference_unique` ON `entries` (`reference`);--> statement-breakpoint
CREATE INDEX `entry_member_date` ON `entries` (`member_id`,`date`);--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`identity` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`city` text NOT NULL,
	`ref` text NOT NULL,
	`parent` text,
	`position` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`status` text DEFAULT 'Draft' NOT NULL,
	`profile` text DEFAULT '{}' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_identity_unique` ON `members` (`identity`);--> statement-breakpoint
CREATE UNIQUE INDEX `members_ref_unique` ON `members` (`ref`);--> statement-breakpoint
CREATE UNIQUE INDEX `binary_position` ON `members` (`parent`,`position`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`assignee` text NOT NULL,
	`assigned_by` text NOT NULL,
	`due` text NOT NULL,
	`status` text DEFAULT 'To do' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `api_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`hash` text NOT NULL,
	`owner` text NOT NULL,
	`created_at` text NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_tokens_hash_unique` ON `api_tokens` (`hash`);