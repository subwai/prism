ALTER TABLE `items` ADD `rating` integer;--> statement-breakpoint
CREATE INDEX `items_rating` ON `items` (`library`,`rating`) WHERE "items"."rating" IS NOT NULL;