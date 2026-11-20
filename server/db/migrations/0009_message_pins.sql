CREATE TABLE `message_pins` (
	`message_id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`pinned_by` text NOT NULL,
	`pinned_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pinned_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `message_pins_channel` ON `message_pins` (`channel_id`,`pinned_at`);