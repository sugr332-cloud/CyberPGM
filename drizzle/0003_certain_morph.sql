CREATE TABLE `shop_stock` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_id` text NOT NULL,
	`item_id` text NOT NULL,
	`quantity` integer,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `shops` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`price_multiplier` real DEFAULT 1 NOT NULL,
	`buyback_rate` real DEFAULT 0.5 NOT NULL,
	`categories` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`character_id` text NOT NULL,
	`shop_id` text,
	`kind` text NOT NULL,
	`lines` text NOT NULL,
	`total_eb` integer NOT NULL,
	`at` integer NOT NULL,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE set null
);
