-- Keeps each folder's path once, in `folders`, and each entry by its folder's number and its
-- name, rather than its path in three columns and three indexes. Written by hand: Drizzle would
-- add `parent` with no value, and leave the indexes it changes as they were.
CREATE TABLE `folders` (
	`folder` integer PRIMARY KEY,
	`library` integer NOT NULL,
	`path` text NOT NULL,
	`key` text NOT NULL,
	`item` integer
);
--> statement-breakpoint
-- Every folder with a row: its path is its ID, and its key is its parent's and its name's, as
-- `parentKey` makes it. The library's own entries have the empty key.
INSERT INTO `folders` (`library`, `path`, `key`, `item`)
  SELECT `library`, `id`,
    iif(`parent_key` = '', `name_key`, `parent_key` || char(1) || `name_key`), `item`
  FROM `items` WHERE `kind` = 0 ORDER BY `item`;
--> statement-breakpoint
CREATE UNIQUE INDEX `folders_path` ON `folders` (`library`,`path`);--> statement-breakpoint
CREATE INDEX `folders_key` ON `folders` (`library`,`key`);--> statement-breakpoint
CREATE INDEX `folders_item` ON `folders` (`item`);--> statement-breakpoint
-- And every other folder an entry is in, which has no row: the library's own, `.`, and any
-- whose row is not in yet.
INSERT INTO `folders` (`library`, `path`, `key`)
  SELECT DISTINCT `library`, `parent_id`, `parent_key` FROM `items`
  WHERE NOT EXISTS (SELECT 1 FROM `folders`
    WHERE `folders`.`library` = `items`.`library` AND `folders`.`path` = `items`.`parent_id`);
--> statement-breakpoint
CREATE TABLE `__new_items` (
	`item` integer PRIMARY KEY AUTOINCREMENT,
	`library` integer NOT NULL,
	`parent` integer NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`name_fold` text NOT NULL,
	`kind` integer NOT NULL,
	`grp` integer NOT NULL,
	`size` integer,
	`created_ms` real,
	`modified_ms` real,
	`accessed_ms` real,
	`exif_read` integer DEFAULT 0 NOT NULL,
	`taken_ms` real,
	`camera` text,
	`lens` text,
	`exif` text,
	`rating` integer,
	`inode` text,
	`has_entries` integer,
	`has_subfolders` integer,
	`covers` text
);
--> statement-breakpoint
-- Each entry keeps its number, and as its name the end of its ID, so its ID is as it was. The
-- `CROSS JOIN` reads the entries in order of number, so the copy appends to the new table.
INSERT INTO `__new_items` (`item`, `library`, `parent`, `name`, `name_key`, `name_fold`,
    `kind`, `grp`, `size`, `created_ms`, `modified_ms`, `accessed_ms`, `exif_read`, `taken_ms`,
    `camera`, `lens`, `exif`, `rating`, `inode`, `has_entries`, `has_subfolders`, `covers`)
  SELECT `items`.`item`, `items`.`library`, `folders`.`folder`,
    iif(`items`.`parent_id` = '.', `items`.`id`,
      substr(`items`.`id`, length(`items`.`parent_id`) + 2)),
    `items`.`name_key`, `items`.`name_fold`, `items`.`kind`, `items`.`grp`, `items`.`size`,
    `items`.`created_ms`, `items`.`modified_ms`, `items`.`accessed_ms`, `items`.`exif_read`,
    `items`.`taken_ms`, `items`.`camera`, `items`.`lens`, `items`.`exif`, `items`.`rating`,
    `items`.`inode`, `items`.`has_entries`, `items`.`has_subfolders`, `items`.`covers`
  FROM `items` CROSS JOIN `folders`
    ON `folders`.`library` = `items`.`library` AND `folders`.`path` = `items`.`parent_id`
  ORDER BY `items`.`item`;
--> statement-breakpoint
-- Numbers never repeat, so the new table goes on from the last one there has been, as the old
-- one would, rather than from the highest one left.
UPDATE `sqlite_sequence` SET `seq` = (SELECT `seq` FROM `sqlite_sequence` WHERE `name` = 'items')
  WHERE `name` = '__new_items';
--> statement-breakpoint
DROP TABLE `items`;--> statement-breakpoint
ALTER TABLE `__new_items` RENAME TO `items`;--> statement-breakpoint
CREATE UNIQUE INDEX `items_entry` ON `items` (`parent`,`name`);--> statement-breakpoint
CREATE INDEX `items_parent` ON `items` (`parent`,`grp`,`name_key`,`kind`);--> statement-breakpoint
CREATE INDEX `items_taken` ON `items` (`library`,`grp`,coalesce("taken_ms", "modified_ms"),`name_key`,`kind`);--> statement-breakpoint
CREATE INDEX `items_kind` ON `items` (`library`,`kind`);--> statement-breakpoint
CREATE INDEX `items_unread` ON `items` (`library`,`item`) WHERE "items"."kind" = 1 AND "items"."exif_read" = 0;--> statement-breakpoint
CREATE INDEX `items_camera` ON `items` (`library`,`camera`) WHERE "items"."camera" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `items_lens` ON `items` (`library`,`lens`) WHERE "items"."lens" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `items_rating` ON `items` (`library`,`rating`) WHERE "items"."rating" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `items_lenders` ON `items` (`parent`,`name_key`) WHERE "items"."kind" = 0 AND "items"."covers" IS NOT NULL AND "items"."covers" <> '[]';
