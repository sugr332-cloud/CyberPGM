CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `characters` ADD `player_id` text REFERENCES players(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `characters` ADD `scenario_id` text REFERENCES scenarios(id) ON DELETE set null;