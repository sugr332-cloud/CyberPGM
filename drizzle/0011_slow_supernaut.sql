ALTER TABLE `items` ADD `effect_ja` text;--> statement-breakpoint
ALTER TABLE `items` ADD `flavor_ja` text;--> statement-breakpoint
ALTER TABLE `items` ADD `effect_is_draft` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `items` ADD `flavor_is_draft` integer DEFAULT false NOT NULL;