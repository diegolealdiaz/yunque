CREATE TABLE `access_grants` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`granted_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `telegram_chats` (
	`chat_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`linked_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `telegram_chats_org_idx` ON `telegram_chats` (`organization_id`);--> statement-breakpoint
CREATE TABLE `telegram_link_tokens` (
	`token` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `telegram_updates` (
	`update_id` integer PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`status` text NOT NULL,
	`received_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `telegram_updates_chat_idx` ON `telegram_updates` (`chat_id`,`status`,`received_at`);