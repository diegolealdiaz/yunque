CREATE TABLE `inbound_receipts` (
	`message_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`token` text NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	`received_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`token`) REFERENCES `inbound_addresses`(`token`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `inbound_receipts_token_idx` ON `inbound_receipts` (`token`,`status`,`received_at`);--> statement-breakpoint
CREATE INDEX `inbound_receipts_org_idx` ON `inbound_receipts` (`organization_id`,`status`,`received_at`);--> statement-breakpoint
CREATE INDEX `inbound_receipts_received_idx` ON `inbound_receipts` (`status`,`received_at`);