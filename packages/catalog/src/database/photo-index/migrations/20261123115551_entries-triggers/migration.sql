-- The triggers named after `items` take the name of `entries`, which the plain-words migration
-- renamed it to. SQLite cannot rename a trigger, so each is made again under its new name, doing
-- what it did.
DROP TRIGGER `items_deleted`;--> statement-breakpoint
CREATE TRIGGER `entries_deleted` AFTER DELETE ON `entries` BEGIN
  DELETE FROM `entry_tags` WHERE `entry` = old.`entry`;
END;--> statement-breakpoint
DROP TRIGGER `items_unread`;--> statement-breakpoint
CREATE TRIGGER `entries_unread` AFTER UPDATE OF `exif_read` ON `entries`
  WHEN new.`exif_read` = 0 AND old.`exif_read` <> 0 BEGIN
  DELETE FROM `entry_tags` WHERE `entry` = old.`entry`;
END;--> statement-breakpoint
DROP TRIGGER `items_details_removed`;--> statement-breakpoint
CREATE TRIGGER `entries_details_removed` AFTER DELETE ON `entries`
  WHEN old.`kind` = 1 AND old.`exif_read` = 1 AND old.`exif` IS NOT NULL
    AND old.`inode` IS NOT NULL AND old.`inode` <> '0'
    AND old.`size` IS NOT NULL AND old.`modified_ms` IS NOT NULL
    AND EXISTS (SELECT 1 FROM `libraries` WHERE `library` = old.`library`) BEGIN
  INSERT OR REPLACE INTO `removed_details`
    VALUES (old.`inode`, old.`size`, old.`modified_ms`, old.`exif`,
      CAST(unixepoch('subsec') * 1000 AS INTEGER));
END;