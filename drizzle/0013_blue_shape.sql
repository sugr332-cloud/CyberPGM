CREATE TABLE `purchase_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`character_id` text NOT NULL,
	`shop_id` text,
	`lines` text NOT NULL,
	`total_eb` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`comment` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE set null
);
