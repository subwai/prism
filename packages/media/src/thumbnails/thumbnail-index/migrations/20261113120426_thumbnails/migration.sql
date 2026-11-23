CREATE TABLE `rebuilds` (
	`finished_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `thumbnails` (
	`key` text PRIMARY KEY,
	`size` integer NOT NULL,
	`used_ms` integer NOT NULL
) WITHOUT ROWID;
--> statement-breakpoint
CREATE INDEX `thumbnails_used` ON `thumbnails` (`used_ms`);