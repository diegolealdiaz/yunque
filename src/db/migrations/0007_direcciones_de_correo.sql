CREATE TABLE `inbound_addresses` (
	`token` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `inbound_addresses_org_expires_idx` ON `inbound_addresses` (`organization_id`,`expires_at`);