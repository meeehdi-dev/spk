CREATE TABLE `gif_favorites` (
	`user_id` text NOT NULL,
	`gif_id` text NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`preview` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	PRIMARY KEY(`user_id`, `gif_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
