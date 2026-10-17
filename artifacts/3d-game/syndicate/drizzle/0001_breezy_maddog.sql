CREATE TABLE `commission_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`member_id` text NOT NULL,
	`member_name` text NOT NULL,
	`plan_version` integer NOT NULL,
	`transactions` integer NOT NULL,
	`turnover` integer NOT NULL,
	`fee` integer NOT NULL,
	`reserve` integer NOT NULL,
	`company` integer NOT NULL,
	`allocations` text NOT NULL,
	`status` text NOT NULL,
	`date` text NOT NULL,
	`created_at` text NOT NULL,
	`note` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `commission_runs_entry_id_unique` ON `commission_runs` (`entry_id`);--> statement-breakpoint
CREATE TABLE `reward_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`amount` integer NOT NULL,
	`status` text NOT NULL,
	`task_id` text,
	`rank` text,
	`period` text NOT NULL,
	`claim_key` text NOT NULL,
	`criteria` text NOT NULL,
	`created_at` text NOT NULL,
	`note` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reward_claims_claim_key_unique` ON `reward_claims` (`claim_key`);--> statement-breakpoint
CREATE TABLE `reward_plans` (
	`version` integer PRIMARY KEY NOT NULL,
	`config` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `tasks` ADD `completed_at` text;