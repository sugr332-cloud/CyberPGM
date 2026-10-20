CREATE TABLE `character_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`image_path` text,
	`character_data` text NOT NULL,
	`created_with` text NOT NULL,
	`validation_results` text NOT NULL,
	`rejection_comment` text,
	`accepted_character_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `skill_notes` (
	`key` text PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	`updated_at` integer NOT NULL
);
