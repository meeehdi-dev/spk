CREATE TABLE `poll_votes` (
	`message_id` text NOT NULL,
	`user_id` text NOT NULL,
	`choice_id` text NOT NULL,
	PRIMARY KEY(`message_id`, `user_id`),
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `messages` ADD `poll` text;