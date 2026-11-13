CREATE TABLE `object_deletions` (
	`key` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`not_before` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `object_deletions_due` ON `object_deletions` (`not_before`);