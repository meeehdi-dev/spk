CREATE TABLE `message_previews` (
	`message_id` text NOT NULL,
	`url` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`message_id`, `url`),
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`url`) REFERENCES `link_previews`(`url`) ON UPDATE no action ON DELETE cascade
);
