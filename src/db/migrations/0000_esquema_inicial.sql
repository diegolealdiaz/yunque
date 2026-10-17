CREATE TABLE `approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`decision_id` text NOT NULL,
	`outcome` text NOT NULL,
	`approver` text NOT NULL,
	`checklist` text NOT NULL,
	`reason` text,
	`payload` text NOT NULL,
	`signature` text NOT NULL,
	`consumed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decision_id`) REFERENCES `decisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `approvals_org_decision_idx` ON `approvals` (`organization_id`,`decision_id`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`type` text NOT NULL,
	`actor` text NOT NULL,
	`invoice_id` text,
	`decision_id` text,
	`data` text NOT NULL,
	`trace_id` text NOT NULL,
	`occurred_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_events_org_occurred_idx` ON `audit_events` (`organization_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `audit_events_org_invoice_idx` ON `audit_events` (`organization_id`,`invoice_id`);--> statement-breakpoint
CREATE TABLE `balances` (
	`organization_id` text NOT NULL,
	`currency` text NOT NULL,
	`available` integer NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`organization_id`, `currency`),
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`verdict` text NOT NULL,
	`findings` text NOT NULL,
	`explanation` text NOT NULL,
	`summary` text,
	`scheduled_for` text,
	`payment_order` text,
	`amount` integer,
	`amount_currency` text,
	`amount_usd` integer,
	`vendor_id` text,
	`policy_version_id` text NOT NULL,
	`policy_hash` text NOT NULL,
	`document_hash` text NOT NULL,
	`extraction_hash` text,
	`field_sources` text NOT NULL,
	`previous_decision_id` text,
	`dry_run` integer NOT NULL,
	`actor` text NOT NULL,
	`cost_usd_micros` integer NOT NULL,
	`latency_ms` integer NOT NULL,
	`decided_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`policy_version_id`) REFERENCES `policy_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `decisions_org_invoice_idx` ON `decisions` (`organization_id`,`invoice_id`);--> statement-breakpoint
CREATE INDEX `decisions_org_decided_idx` ON `decisions` (`organization_id`,`decided_at`);--> statement-breakpoint
CREATE TABLE `extractions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`document_hash` text NOT NULL,
	`record` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `extractions_org_invoice_idx` ON `extractions` (`organization_id`,`invoice_id`);--> statement-breakpoint
CREATE INDEX `extractions_org_document_idx` ON `extractions` (`organization_id`,`document_hash`);--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`reference` text NOT NULL,
	`channel` text NOT NULL,
	`source_kind` text NOT NULL,
	`document_hash` text NOT NULL,
	`file_key` text NOT NULL,
	`file_state` text NOT NULL,
	`original_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`page_keys` text NOT NULL,
	`text` text,
	`semantic_key` text,
	`status` text NOT NULL,
	`approval_expires_at` text,
	`channel_meta` text NOT NULL,
	`received_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_org_document_hash_idx` ON `invoices` (`organization_id`,`document_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_org_reference_idx` ON `invoices` (`organization_id`,`reference`);--> statement-breakpoint
CREATE INDEX `invoices_org_semantic_key_idx` ON `invoices` (`organization_id`,`semantic_key`);--> statement-breakpoint
CREATE INDEX `invoices_org_status_idx` ON `invoices` (`organization_id`,`status`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`locked_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `jobs_org_status_idx` ON `jobs` (`organization_id`,`status`);--> statement-breakpoint
CREATE TABLE `ledger_periods` (
	`organization_id` text NOT NULL,
	`period_key` text NOT NULL,
	`currency` text NOT NULL,
	`limit` integer NOT NULL,
	`committed` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`organization_id`, `period_key`, `currency`),
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `llm_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`invoice_id` text,
	`model` text NOT NULL,
	`prompt_version` text NOT NULL,
	`prompt_hash` text NOT NULL,
	`raw_output` text,
	`attempt` integer NOT NULL,
	`input_tokens` integer,
	`output_tokens` integer,
	`cost_usd_micros` integer,
	`latency_ms` integer NOT NULL,
	`status` text NOT NULL,
	`trace_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `llm_calls_org_invoice_idx` ON `llm_calls` (`organization_id`,`invoice_id`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`channel` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`payload` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_org_key_idx` ON `notifications` (`organization_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `notifications_org_status_idx` ON `notifications` (`organization_id`,`status`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`reference_prefix` text NOT NULL,
	`base_currency` text NOT NULL,
	`fx` text NOT NULL,
	`demo_visitor_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organizations_demo_visitor_idx` ON `organizations` (`demo_visitor_id`);--> statement-breakpoint
CREATE TABLE `policy_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`version` integer NOT NULL,
	`content` text NOT NULL,
	`content_hash` text NOT NULL,
	`signed_by` text NOT NULL,
	`signed_at` text NOT NULL,
	`note` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `policy_versions_org_version_idx` ON `policy_versions` (`organization_id`,`version`);--> statement-breakpoint
CREATE TABLE `reference_counters` (
	`organization_id` text NOT NULL,
	`year_month` text NOT NULL,
	`next_sequence` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`organization_id`, `year_month`),
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `vendors` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`aliases` text NOT NULL,
	`tax_id` text,
	`country` text NOT NULL,
	`account` text NOT NULL,
	`verification` text NOT NULL,
	`agreement` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `vendors_org_idx` ON `vendors` (`organization_id`);