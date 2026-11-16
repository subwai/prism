-- The folders' migration made `items` afresh, which took its triggers with it.
-- A photo's tags go with it, and with its details when its file changes since they were read.
CREATE TRIGGER `items_deleted` AFTER DELETE ON `items` BEGIN
  DELETE FROM `item_tags` WHERE `item` = old.`item`;
END;
--> statement-breakpoint
CREATE TRIGGER `items_unread` AFTER UPDATE OF `exif_read` ON `items`
  WHEN new.`exif_read` = 0 AND old.`exif_read` <> 0 BEGIN
  DELETE FROM `item_tags` WHERE `item` = old.`item`;
END;
--> statement-breakpoint
-- `folders` keeps a folder for each row of one: its path is its parent's and its name, joined by
-- the separator of the library's paths, which is `/` where an absolute path starts with one and
-- `\` on Windows, where none does; its key is its parent's and its name's. A folder already
-- there, as one an entry inside it came to first, keeps its number, so what is inside stays in it.
CREATE TRIGGER `folders_added` AFTER INSERT ON `items` WHEN new.`kind` = 0 BEGIN
  INSERT INTO `folders` (`library`, `path`, `key`, `item`)
    SELECT new.`library`,
      iif(`parent`.`path` = '.', new.`name`, `parent`.`path`
        || (SELECT iif(substr(`root`, 1, 1) = '/', '/', char(92)) FROM `libraries`
          WHERE `library` = new.`library`)
        || new.`name`),
      iif(`parent`.`key` = '', new.`name_key`, `parent`.`key` || char(1) || new.`name_key`),
      new.`item`
    FROM `folders` AS `parent` WHERE `parent`.`folder` = new.`parent`
    ON CONFLICT (`library`, `path`) DO UPDATE SET `item` = excluded.`item`;
END;
--> statement-breakpoint
CREATE TRIGGER `folders_became` AFTER UPDATE OF `kind` ON `items`
  WHEN new.`kind` = 0 AND old.`kind` <> 0 BEGIN
  INSERT INTO `folders` (`library`, `path`, `key`, `item`)
    SELECT new.`library`,
      iif(`parent`.`path` = '.', new.`name`, `parent`.`path`
        || (SELECT iif(substr(`root`, 1, 1) = '/', '/', char(92)) FROM `libraries`
          WHERE `library` = new.`library`)
        || new.`name`),
      iif(`parent`.`key` = '', new.`name_key`, `parent`.`key` || char(1) || new.`name_key`),
      new.`item`
    FROM `folders` AS `parent` WHERE `parent`.`folder` = new.`parent`
    ON CONFLICT (`library`, `path`) DO UPDATE SET `item` = excluded.`item`;
END;
--> statement-breakpoint
-- A folder whose row goes keeps its number while entries are still in it, as when its row goes
-- before theirs, and goes with the last of them.
CREATE TRIGGER `folders_removed` AFTER DELETE ON `items` WHEN old.`kind` = 0 BEGIN
  DELETE FROM `folders` WHERE `item` = old.`item`
    AND NOT EXISTS (SELECT 1 FROM `items` WHERE `parent` = `folders`.`folder`);
  UPDATE `folders` SET `item` = NULL WHERE `item` = old.`item`;
END;
--> statement-breakpoint
CREATE TRIGGER `folders_ceased` AFTER UPDATE OF `kind` ON `items`
  WHEN old.`kind` = 0 AND new.`kind` <> 0 BEGIN
  DELETE FROM `folders` WHERE `item` = old.`item`
    AND NOT EXISTS (SELECT 1 FROM `items` WHERE `parent` = `folders`.`folder`);
  UPDATE `folders` SET `item` = NULL WHERE `item` = old.`item`;
END;
--> statement-breakpoint
CREATE TRIGGER `folders_emptied` AFTER DELETE ON `items` BEGIN
  DELETE FROM `folders` WHERE `folder` = old.`parent` AND `item` IS NULL
    AND NOT EXISTS (SELECT 1 FROM `items` WHERE `parent` = old.`parent`);
END;
