ALTER TABLE `items` ADD `has_entries` integer;--> statement-breakpoint
ALTER TABLE `items` ADD `has_subfolders` integer;--> statement-breakpoint
ALTER TABLE `items` ADD `covers` text;--> statement-breakpoint
CREATE INDEX `items_uncovered` ON `items` (`library`,`item`) WHERE "items"."kind" = 0 AND "items"."covers" IS NULL;