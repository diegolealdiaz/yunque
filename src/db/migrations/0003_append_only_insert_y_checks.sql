-- Append-only también frente a INSERT OR REPLACE: SQLite no dispara los triggers de DELETE
-- en una resolución REPLACE, así que se bloquea el reemplazo de un id existente al insertar.
CREATE TRIGGER policy_versions_no_replace BEFORE INSERT ON policy_versions
WHEN EXISTS (SELECT 1 FROM policy_versions WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'append_only: policy_versions'); END;
--> statement-breakpoint
CREATE TRIGGER decisions_no_replace BEFORE INSERT ON decisions
WHEN EXISTS (SELECT 1 FROM decisions WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'append_only: decisions'); END;
--> statement-breakpoint
CREATE TRIGGER audit_events_no_replace BEFORE INSERT ON audit_events
WHEN EXISTS (SELECT 1 FROM audit_events WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'append_only: audit_events'); END;
--> statement-breakpoint
CREATE TRIGGER approvals_no_replace BEFORE INSERT ON approvals
WHEN EXISTS (SELECT 1 FROM approvals WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'append_only: approvals'); END;
--> statement-breakpoint
-- Invariantes numéricas que hoy viven en el WHERE de los repositorios, ahora también en la base.
CREATE TRIGGER balances_non_negative BEFORE UPDATE OF available ON balances
WHEN NEW.available < 0
BEGIN SELECT RAISE(ABORT, 'check: balances.available >= 0'); END;
--> statement-breakpoint
CREATE TRIGGER balances_non_negative_insert BEFORE INSERT ON balances
WHEN NEW.available < 0
BEGIN SELECT RAISE(ABORT, 'check: balances.available >= 0'); END;
--> statement-breakpoint
-- Solo al mover lo comprometido: bajar el límite por debajo de lo ya comprometido es válido
-- (la política cambió a mitad de periodo) y simplemente impide reservas nuevas.
CREATE TRIGGER ledger_within_limit BEFORE UPDATE OF committed ON ledger_periods
WHEN NEW.committed < 0 OR NEW.committed > NEW."limit"
BEGIN SELECT RAISE(ABORT, 'check: ledger_periods.committed between 0 and limit'); END;
--> statement-breakpoint
CREATE TRIGGER ledger_within_limit_insert BEFORE INSERT ON ledger_periods
WHEN NEW.committed < 0 OR NEW.committed > NEW."limit"
BEGIN SELECT RAISE(ABORT, 'check: ledger_periods.committed between 0 and limit'); END;
--> statement-breakpoint
CREATE TRIGGER reference_counters_positive BEFORE UPDATE OF next_sequence ON reference_counters
WHEN NEW.next_sequence < 1
BEGIN SELECT RAISE(ABORT, 'check: reference_counters.next_sequence >= 1'); END;
