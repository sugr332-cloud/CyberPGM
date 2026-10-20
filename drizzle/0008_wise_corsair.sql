CREATE TABLE `clues` (
	`id` text PRIMARY KEY NOT NULL,
	`scenario_id` text NOT NULL,
	`scene_id` text,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`image_id` text,
	FOREIGN KEY (`scenario_id`) REFERENCES `scenarios`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scene_id`) REFERENCES `scenes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `encounters` (
	`id` text PRIMARY KEY NOT NULL,
	`scenario_id` text NOT NULL,
	`scene_id` text,
	`title` text NOT NULL,
	`participants` text DEFAULT '[]' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`scenario_id`) REFERENCES `scenarios`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scene_id`) REFERENCES `scenes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `handouts` (
	`id` text PRIMARY KEY NOT NULL,
	`scenario_id` text NOT NULL,
	`scene_id` text,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`image_id` text,
	FOREIGN KEY (`scenario_id`) REFERENCES `scenarios`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scene_id`) REFERENCES `scenes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `random_tables` (
	`id` text PRIMARY KEY NOT NULL,
	`scenario_id` text,
	`title` text NOT NULL,
	`dice` text NOT NULL,
	`rows` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`scenario_id`) REFERENCES `scenarios`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `scenario_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`scenario_id` text NOT NULL,
	`version` integer NOT NULL,
	`snapshot` text NOT NULL,
	`saved_at` integer NOT NULL,
	FOREIGN KEY (`scenario_id`) REFERENCES `scenarios`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `scenarios` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`meta` text DEFAULT '{}' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scene_choices` (
	`id` text PRIMARY KEY NOT NULL,
	`scene_id` text NOT NULL,
	`label` text NOT NULL,
	`skill_key` text,
	`dv` integer,
	`who` text DEFAULT '全員' NOT NULL,
	`on_success` text DEFAULT '[]' NOT NULL,
	`on_failure` text DEFAULT '[]' NOT NULL,
	`sort_index` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`scene_id`) REFERENCES `scenes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `scene_links` (
	`id` text PRIMARY KEY NOT NULL,
	`scenario_id` text NOT NULL,
	`from_scene_id` text NOT NULL,
	`to_scene_id` text NOT NULL,
	`condition` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`scenario_id`) REFERENCES `scenarios`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_scene_id`) REFERENCES `scenes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_scene_id`) REFERENCES `scenes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `scenes` (
	`id` text PRIMARY KEY NOT NULL,
	`scenario_id` text NOT NULL,
	`title` text NOT NULL,
	`read_aloud` text DEFAULT '' NOT NULL,
	`gm_notes` text DEFAULT '' NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`npc_ids` text DEFAULT '[]' NOT NULL,
	`position` text DEFAULT '{"x":100,"y":100}' NOT NULL,
	`background_image_id` text,
	`board_id` text,
	`sort_index` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`scenario_id`) REFERENCES `scenarios`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`background_image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `images` ADD `title` text;