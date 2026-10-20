CREATE TABLE `boards` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`background_image_id` text,
	`grid` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`background_image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `board_drops` (
	`id` text PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`x` integer NOT NULL,
	`y` integer NOT NULL,
	`inventory_entry` text NOT NULL,
	`from_character_id` text,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `board_objects` (
	`id` text PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`x` integer NOT NULL,
	`y` integer NOT NULL,
	`w` integer NOT NULL,
	`h` integer NOT NULL,
	`rotation` integer DEFAULT 0 NOT NULL,
	`passable` integer DEFAULT true NOT NULL,
	`blocks_los` text DEFAULT 'none' NOT NULL,
	`cover_hp` integer,
	`cover_hp_max` integer,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `board_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`character_id` text,
	`x` integer NOT NULL,
	`y` integer NOT NULL,
	`gm_only` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `combats` ADD `board_id` text REFERENCES boards(id);