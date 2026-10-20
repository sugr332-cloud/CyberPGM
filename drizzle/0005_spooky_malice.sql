CREATE TABLE `combat_log` (
	`id` text PRIMARY KEY NOT NULL,
	`combat_id` text NOT NULL,
	`round` integer NOT NULL,
	`actor_id` text NOT NULL,
	`action_key` text NOT NULL,
	`input` text DEFAULT '{}' NOT NULL,
	`breakdown` text DEFAULT '{}' NOT NULL,
	`changes` text DEFAULT '[]' NOT NULL,
	`undone` integer DEFAULT false NOT NULL,
	`at` integer NOT NULL,
	FOREIGN KEY (`combat_id`) REFERENCES `combats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `combat_participants` (
	`id` text PRIMARY KEY NOT NULL,
	`combat_id` text NOT NULL,
	`character_id` text,
	`side` text DEFAULT 'enemy' NOT NULL,
	`name` text NOT NULL,
	`initiative` integer DEFAULT 0 NOT NULL,
	`initiative_roll` text DEFAULT '{}' NOT NULL,
	`order_index` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`out` integer DEFAULT false NOT NULL,
	`move_used` integer DEFAULT false NOT NULL,
	`action_used` integer DEFAULT false NOT NULL,
	`state` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`combat_id`) REFERENCES `combats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `combats` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'setup' NOT NULL,
	`round` integer DEFAULT 1 NOT NULL,
	`turn_index` integer DEFAULT 0 NOT NULL,
	`settings` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`ended_at` integer
);
--> statement-breakpoint
ALTER TABLE `weapons` ADD `suppressive` integer;