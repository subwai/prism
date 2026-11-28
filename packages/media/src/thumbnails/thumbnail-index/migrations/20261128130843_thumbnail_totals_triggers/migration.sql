-- The total starts as the sum of the thumbnails the index already has, once, as it is migrated.
INSERT INTO `thumbnail_totals` (`bytes`) SELECT coalesce(sum(`size`), 0) FROM `thumbnails`;
--> statement-breakpoint
-- Each change to `thumbnails` moves the total by as much, inside the transaction that made it, so
-- it is right whichever process wrote. An upsert that updates a row runs the update trigger.
CREATE TRIGGER `thumbnails_added` AFTER INSERT ON `thumbnails` BEGIN
  UPDATE `thumbnail_totals` SET `bytes` = `bytes` + new.`size`;
END;
--> statement-breakpoint
CREATE TRIGGER `thumbnails_resized` AFTER UPDATE OF `size` ON `thumbnails` BEGIN
  UPDATE `thumbnail_totals` SET `bytes` = `bytes` + new.`size` - old.`size`;
END;
--> statement-breakpoint
CREATE TRIGGER `thumbnails_removed` AFTER DELETE ON `thumbnails` BEGIN
  UPDATE `thumbnail_totals` SET `bytes` = `bytes` - old.`size`;
END;
