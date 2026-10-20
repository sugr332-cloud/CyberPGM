CREATE TABLE `scenario_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`scenario_id` text NOT NULL,
	`current_scene_id` text,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`revealed` text DEFAULT '{"clue_ids":[],"handout_ids":[]}' NOT NULL,
	FOREIGN KEY (`scenario_id`) REFERENCES `scenarios`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`current_scene_id`) REFERENCES `scenes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `session_log` (
	`id` text PRIMARY KEY NOT NULL,
	`scenario_session_id` text NOT NULL,
	`at` integer NOT NULL,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`ref` text,
	FOREIGN KEY (`scenario_session_id`) REFERENCES `scenario_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `story_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`scenario_session_id` text NOT NULL,
	`scene_id` text,
	`choice_id` text,
	`actor_character_id` text NOT NULL,
	`skill_key` text,
	`dv` integer,
	`opposed` text,
	`rolls` text DEFAULT '[]' NOT NULL,
	`result` text,
	`applied_log_id` text,
	FOREIGN KEY (`scenario_session_id`) REFERENCES `scenario_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scene_id`) REFERENCES `scenes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`choice_id`) REFERENCES `scene_choices`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`actor_character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `boards` ADD `fog` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `scenes` ADD `is_adhoc` integer DEFAULT false NOT NULL;