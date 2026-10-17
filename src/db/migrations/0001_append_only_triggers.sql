-- Tablas append-only: ningún UPDATE ni DELETE prospera. La bitácora, las decisiones y las
-- versiones de política son historia; corregir es agregar una fila nueva.

CREATE TRIGGER policy_versions_no_update BEFORE UPDATE ON policy_versions
BEGIN SELECT RAISE(ABORT, 'append_only: policy_versions'); END;
--> statement-breakpoint
CREATE TRIGGER policy_versions_no_delete BEFORE DELETE ON policy_versions
BEGIN SELECT RAISE(ABORT, 'append_only: policy_versions'); END;
--> statement-breakpoint
CREATE TRIGGER decisions_no_update BEFORE UPDATE ON decisions
BEGIN SELECT RAISE(ABORT, 'append_only: decisions'); END;
--> statement-breakpoint
CREATE TRIGGER decisions_no_delete BEFORE DELETE ON decisions
BEGIN SELECT RAISE(ABORT, 'append_only: decisions'); END;
--> statement-breakpoint
CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events
BEGIN SELECT RAISE(ABORT, 'append_only: audit_events'); END;
--> statement-breakpoint
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events
BEGIN SELECT RAISE(ABORT, 'append_only: audit_events'); END;
--> statement-breakpoint
-- Aprobaciones: solo `consumed_at` cambia, y solo una vez, de NULL a un valor.
CREATE TRIGGER approvals_no_update BEFORE UPDATE OF
  id, organization_id, invoice_id, decision_id, outcome, approver, checklist, reason, payload, signature, created_at
ON approvals
BEGIN SELECT RAISE(ABORT, 'append_only: approvals'); END;
--> statement-breakpoint
CREATE TRIGGER approvals_consume_once BEFORE UPDATE OF consumed_at ON approvals
WHEN OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL
BEGIN SELECT RAISE(ABORT, 'append_only: approvals.consumed_at'); END;
--> statement-breakpoint
CREATE TRIGGER approvals_no_delete BEFORE DELETE ON approvals
BEGIN SELECT RAISE(ABORT, 'append_only: approvals'); END;
