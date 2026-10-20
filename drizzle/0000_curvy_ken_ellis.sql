CREATE TABLE `armors` (
	`item_id` text PRIMARY KEY NOT NULL,
	`sp_head` integer,
	`sp_body` integer,
	`is_head` integer,
	`is_body` integer,
	`is_shield` integer,
	`shield_hp` integer,
	`penalty` integer,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `cyberwares` (
	`item_id` text PRIMARY KEY NOT NULL,
	`cw_type` text,
	`install_location` text,
	`humanity_loss_roll` text,
	`humanity_loss_static` integer,
	`is_core` integer,
	`slot_size` integer,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `images` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text,
	`path` text NOT NULL,
	`origin` text NOT NULL,
	`license` text,
	`attribution` text,
	`source_book` text,
	`source_page` integer,
	`visibility` text DEFAULT 'gm' NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `import_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`source_commit` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`report` text
);
--> statement-breakpoint
CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name_en` text NOT NULL,
	`name_ja` text,
	`name_ja_override` text,
	`summary_ja` text,
	`description_en` text,
	`price_eb` integer,
	`price_category` text,
	`source_book` text,
	`source_page_en` integer,
	`source_page_ja` integer,
	`origin` text NOT NULL,
	`verify_status` text NOT NULL,
	`fvtt_id` text,
	`fvtt_type` text,
	`raw_system` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `items_fvtt_id_unique` ON `items` (`fvtt_id`);--> statement-breakpoint
CREATE TABLE `rule_constants` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`source_page_ja` integer,
	`note` text
);
--> statement-breakpoint
CREATE TABLE `weapons` (
	`item_id` text PRIMARY KEY NOT NULL,
	`weapon_type` text,
	`skill` text,
	`damage` text,
	`rof` integer,
	`magazine_max` integer,
	`hands` integer,
	`concealable` integer,
	`quality` text,
	`autofire` integer,
	`crit_fail_effect` text,
	`dv_table_key` text,
	`ammo_types` text,
	`is_ranged` integer,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
