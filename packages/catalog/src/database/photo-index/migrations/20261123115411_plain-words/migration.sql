DROP INDEX IF EXISTS `items_entry`;--> statement-breakpoint
DROP INDEX IF EXISTS `items_parent`;--> statement-breakpoint
DROP INDEX IF EXISTS `items_taken`;--> statement-breakpoint
DROP INDEX IF EXISTS `items_kind`;--> statement-breakpoint
DROP INDEX IF EXISTS `items_unread`;--> statement-breakpoint
DROP INDEX IF EXISTS `items_unreadable`;--> statement-breakpoint
DROP INDEX IF EXISTS `items_camera`;--> statement-breakpoint
DROP INDEX IF EXISTS `items_lens`;--> statement-breakpoint
DROP INDEX IF EXISTS `items_rating`;--> statement-breakpoint
DROP INDEX IF EXISTS `items_lenders`;--> statement-breakpoint
DROP INDEX IF EXISTS `item_tags_item`;--> statement-breakpoint
DROP INDEX IF EXISTS `folders_item`;--> statement-breakpoint
ALTER TABLE `items` RENAME TO `entries`;--> statement-breakpoint
ALTER TABLE `item_tags` RENAME TO `entry_tags`;--> statement-breakpoint
ALTER TABLE `folder_skeletons` RENAME TO `tree_listings`;--> statement-breakpoint
ALTER TABLE `entries` RENAME COLUMN `item` TO `entry`;--> statement-breakpoint
ALTER TABLE `entry_tags` RENAME COLUMN `item` TO `entry`;--> statement-breakpoint
ALTER TABLE `folders` RENAME COLUMN `item` TO `entry`;--> statement-breakpoint
CREATE UNIQUE INDEX `entries_name` ON `entries` (`parent`,`name`);--> statement-breakpoint
CREATE INDEX `entries_parent` ON `entries` (`parent`,`grp`,`name_key`,`kind`);--> statement-breakpoint
CREATE INDEX `entries_taken` ON `entries` (`library`,`grp`,coalesce("taken_ms", "modified_ms"),`name_key`,`kind`);--> statement-breakpoint
CREATE INDEX `entries_kind` ON `entries` (`library`,`kind`);--> statement-breakpoint
CREATE INDEX `entries_unread` ON `entries` (`library`,`entry`) WHERE "entries"."kind" = 1 AND "entries"."exif_read" = 0;--> statement-breakpoint
CREATE INDEX `entries_unreadable` ON `entries` (`library`) WHERE "entries"."kind" = 1 AND "entries"."exif_read" = 2;--> statement-breakpoint
CREATE INDEX `entries_camera` ON `entries` (`library`,`camera`) WHERE "entries"."camera" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `entries_lens` ON `entries` (`library`,`lens`) WHERE "entries"."lens" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `entries_rating` ON `entries` (`library`,`rating`) WHERE "entries"."rating" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `entries_folders_with_covers` ON `entries` (`parent`,`name_key`) WHERE "entries"."kind" = 0 AND "entries"."covers" IS NOT NULL AND "entries"."covers" <> '[]';--> statement-breakpoint
CREATE INDEX `entry_tags_entry` ON `entry_tags` (`entry`);--> statement-breakpoint
CREATE INDEX `folders_entry` ON `folders` (`entry`);