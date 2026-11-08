CREATE TABLE `entries` (
	`root` text NOT NULL,
	`parent_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`size` integer,
	`modified_ms` real,
	`created_ms` real,
	`accessed_ms` real,
	`exif` text,
	CONSTRAINT `entries_pk` PRIMARY KEY(`root`, `parent_id`, `name`)
) WITHOUT ROWID;
--> statement-breakpoint
CREATE TABLE `exif` (
	`path` text PRIMARY KEY,
	`identity` text,
	`size` integer NOT NULL,
	`modified_ms` real NOT NULL,
	`exif` text NOT NULL,
	`used_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `folders` (
	`root` text NOT NULL,
	`directory_id` text NOT NULL,
	`detail` text NOT NULL,
	`count` integer NOT NULL,
	`used_ms` integer NOT NULL,
	CONSTRAINT `folders_pk` PRIMARY KEY(`root`, `directory_id`)
) WITHOUT ROWID;
--> statement-breakpoint
CREATE TABLE `indexed_folders` (
	`library` integer NOT NULL,
	`directory_id` text NOT NULL,
	CONSTRAINT `indexed_folders_pk` PRIMARY KEY(`library`, `directory_id`)
) WITHOUT ROWID;
--> statement-breakpoint
CREATE TABLE `item_tags` (
	`library` integer NOT NULL,
	`tag` text NOT NULL,
	`item` integer NOT NULL,
	CONSTRAINT `item_tags_pk` PRIMARY KEY(`library`, `tag`, `item`)
) WITHOUT ROWID;
--> statement-breakpoint
CREATE TABLE `items` (
	`item` integer PRIMARY KEY AUTOINCREMENT,
	`library` integer NOT NULL,
	`id` text NOT NULL,
	`parent_id` text NOT NULL,
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
	`exif` text
);
--> statement-breakpoint
CREATE TABLE `libraries` (
	`library` integer PRIMARY KEY,
	`root` text NOT NULL UNIQUE,
	`used_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `exif_identity` ON `exif` (`identity`);--> statement-breakpoint
CREATE INDEX `item_tags_item` ON `item_tags` (`item`);--> statement-breakpoint
CREATE UNIQUE INDEX `items_id` ON `items` (`library`,`id`);--> statement-breakpoint
CREATE INDEX `items_parent` ON `items` (`library`,`parent_id`);--> statement-breakpoint
CREATE INDEX `items_name` ON `items` (`library`,`grp`,`name_key`,`kind`);--> statement-breakpoint
CREATE INDEX `items_taken` ON `items` (`library`,`grp`,coalesce("taken_ms", "modified_ms"),`name_key`,`kind`);--> statement-breakpoint
CREATE INDEX `items_kind` ON `items` (`library`,`kind`);--> statement-breakpoint
CREATE INDEX `items_unread` ON `items` (`library`,`item`) WHERE "items"."kind" = 1 AND "items"."exif_read" = 0;--> statement-breakpoint
CREATE INDEX `items_camera` ON `items` (`library`,`camera`) WHERE "items"."camera" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `items_lens` ON `items` (`library`,`lens`) WHERE "items"."lens" IS NOT NULL;