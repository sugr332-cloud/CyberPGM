CREATE TABLE `audio` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`path` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`duration_sec` real,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `characters` ADD `portrait_image_id` text REFERENCES images(id);--> statement-breakpoint
ALTER TABLE `scenes` ADD `stage` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `scenes` ADD `bgm` text;