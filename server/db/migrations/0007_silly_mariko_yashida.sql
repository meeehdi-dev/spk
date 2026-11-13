CREATE TABLE `radio_favorites` (
	`user_id` text NOT NULL,
	`station_id` text NOT NULL,
	`name` text NOT NULL,
	`country` text NOT NULL,
	`codec` text NOT NULL,
	PRIMARY KEY(`user_id`, `station_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
