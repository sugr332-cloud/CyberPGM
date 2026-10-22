ALTER TABLE `characters` ADD `extra` text DEFAULT '{}' NOT NULL;
--> statement-breakpoint
ALTER TABLE `story_checks` ADD `luck` integer DEFAULT 0 NOT NULL;
