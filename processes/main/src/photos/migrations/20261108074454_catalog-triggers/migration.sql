-- A photo's tags go with it, and with its details when its file changes since they were read.
CREATE TRIGGER `items_deleted` AFTER DELETE ON `items` BEGIN
  DELETE FROM `item_tags` WHERE `item` = old.`item`;
END;
--> statement-breakpoint
CREATE TRIGGER `items_unread` AFTER UPDATE OF `exif_read` ON `items`
  WHEN new.`exif_read` = 0 AND old.`exif_read` <> 0 BEGIN
  DELETE FROM `item_tags` WHERE `item` = old.`item`;
END;
