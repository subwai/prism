-- A photo whose row goes leaves its details by its file's inode, size and time, so a row that
-- lists the same file again, as moved, renamed or put back from Trash, takes them back rather
-- than reading it. Not a library's rows, which go once its own row has, as pruning drops it:
-- they would fill the table with every photo of it. Nor a file with no inode, as on some disks.
CREATE TRIGGER `items_details_removed` AFTER DELETE ON `items`
  WHEN old.`kind` = 1 AND old.`exif_read` = 1 AND old.`exif` IS NOT NULL
    AND old.`inode` IS NOT NULL AND old.`inode` <> '0'
    AND old.`size` IS NOT NULL AND old.`modified_ms` IS NOT NULL
    AND EXISTS (SELECT 1 FROM `libraries` WHERE `library` = old.`library`) BEGIN
  INSERT OR REPLACE INTO `removed_details`
    VALUES (old.`inode`, old.`size`, old.`modified_ms`, old.`exif`,
      CAST(unixepoch('subsec') * 1000 AS INTEGER));
END;
