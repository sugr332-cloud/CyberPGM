CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `char_log` (
	`id` text PRIMARY KEY NOT NULL,
	`character_id` text NOT NULL,
	`text` text NOT NULL,
	`at` integer NOT NULL,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `characters` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text DEFAULT 'pc' NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`image_id` text,
	`stats` text NOT NULL,
	`skills` text DEFAULT '{}' NOT NULL,
	`hp` integer NOT NULL,
	`hp_max` integer NOT NULL,
	`sp_head` integer DEFAULT 0 NOT NULL,
	`sp_body` integer DEFAULT 0 NOT NULL,
	`humanity` integer NOT NULL,
	`emp_max` integer NOT NULL,
	`cyberware` text DEFAULT '[]' NOT NULL,
	`weapons` text DEFAULT '[]' NOT NULL,
	`inventory` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT '[]' NOT NULL,
	`crit_injuries` text DEFAULT '[]' NOT NULL,
	`eb` integer DEFAULT 0 NOT NULL,
	`notes_gm` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`role` text NOT NULL,
	`character_id` text,
	`label` text,
	`last_seen_at` integer NOT NULL,
	`revoked` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `devices_token_hash_unique` ON `devices` (`token_hash`);--> statement-breakpoint
CREATE TABLE `money_log` (
	`id` text PRIMARY KEY NOT NULL,
	`character_id` text NOT NULL,
	`amount` integer NOT NULL,
	`reason` text NOT NULL,
	`balance_after` integer NOT NULL,
	`at` integer NOT NULL,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `saves` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'manual' NOT NULL,
	`summary` text,
	`file` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
