-- Keeps photos' details only on their rows, and those of rows removed by their file's inode,
-- rather than every photo's again by its path in the `exif` cache, which took two fifths of
-- the file. `WITHOUT ROWID` is added by hand, as Drizzle cannot declare it.
CREATE TABLE `removed_details` (
	`inode` text NOT NULL,
	`size` integer NOT NULL,
	`modified_ms` real NOT NULL,
	`exif` text NOT NULL,
	`removed_ms` integer NOT NULL,
	CONSTRAINT `removed_details_pk` PRIMARY KEY(`inode`, `size`, `modified_ms`)
) WITHOUT ROWID;
--> statement-breakpoint
-- The cache's rows that no row holds, such as of photos in Trash, carry over, by their inode
-- without the device, and go when they would have: half a year after they were last used.
INSERT OR REPLACE INTO `removed_details`
  SELECT substr(`identity`, instr(`identity`, ':') + 1), `size`, `modified_ms`, `exif`, `used_ms`
  FROM `exif` WHERE `identity` IS NOT NULL ORDER BY `used_ms`;
--> statement-breakpoint
DELETE FROM `removed_details` WHERE (`inode`, `size`, `modified_ms`) IN
  (SELECT `inode`, `size`, `modified_ms` FROM `items` WHERE `kind` = 1 AND `exif_read` = 1);
--> statement-breakpoint
DROP INDEX IF EXISTS `exif_identity`;--> statement-breakpoint
DROP TABLE `exif`;
