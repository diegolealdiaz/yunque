CREATE TABLE `extraction_cache` (
	`scope` text NOT NULL,
	`key_hash` text NOT NULL,
	`record` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`scope`, `key_hash`)
);
--> statement-breakpoint
DROP INDEX `invoices_org_document_hash_idx`;--> statement-breakpoint
-- SQLite exige un valor por defecto para agregar una columna NOT NULL. Las facturas que ya
-- existan reciben una llave de recepción única derivada de su id; las nuevas la traen siempre.
ALTER TABLE `invoices` ADD `receipt_key` text NOT NULL DEFAULT '';--> statement-breakpoint
UPDATE `invoices` SET `receipt_key` = 'legado:' || `id` WHERE `receipt_key` = '';--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_org_receipt_key_idx` ON `invoices` (`organization_id`,`receipt_key`);--> statement-breakpoint
CREATE INDEX `invoices_org_document_hash_idx` ON `invoices` (`organization_id`,`document_hash`);