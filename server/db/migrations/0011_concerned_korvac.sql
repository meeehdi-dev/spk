CREATE TABLE `webhooks` (
	`channel_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`icon` text NOT NULL,
	`secret_hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhooks_secret_hash_unique` ON `webhooks` (`secret_hash`);--> statement-breakpoint
ALTER TABLE `messages` ADD `embed` text;