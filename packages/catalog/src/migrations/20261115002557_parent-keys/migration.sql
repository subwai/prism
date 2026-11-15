ALTER TABLE `items` ADD `parent_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
-- Each folder's key, as `parentKey` makes it: its parent's, then its own name's, joined by a
-- character that comes first. The library's own entries keep the empty key.
CREATE TEMP TABLE `folder_keys` AS
  WITH RECURSIVE `keys`(`library`, `id`, `key`) AS (
    SELECT `library`, `id`, `name_key` FROM `items` WHERE `kind` = 0 AND `parent_id` = '.'
    UNION ALL
    SELECT `items`.`library`, `items`.`id`, `keys`.`key` || char(1) || `items`.`name_key`
    FROM `items` JOIN `keys`
      ON `items`.`library` = `keys`.`library` AND `items`.`parent_id` = `keys`.`id`
    WHERE `items`.`kind` = 0
  )
  SELECT * FROM `keys`;--> statement-breakpoint
UPDATE `items` SET `parent_key` = `folder_keys`.`key` FROM `folder_keys`
  WHERE `items`.`library` = `folder_keys`.`library` AND `items`.`parent_id` = `folder_keys`.`id`;--> statement-breakpoint
DROP TABLE `folder_keys`;--> statement-breakpoint
-- Drizzle records the index's new column in its snapshot but writes nothing to change it.
DROP INDEX `items_name`;--> statement-breakpoint
CREATE INDEX `items_name` ON `items` (`library`,`grp`,`parent_key`,`name_key`,`kind`);
