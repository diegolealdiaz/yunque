import type { Config } from "@/src/config";
import type { ReceiptKey, Ulid } from "@/src/domain";
import type { Database } from "@/src/db/client";
import { assertWithinDailyLimits, startOfBusinessDay, type DailyLimits } from "@/src/usecases";

/**
 * Topes de facturas de la demo, iguales para todo canal: por visitante y de toda la demo,
 * contados desde el inicio del día de negocio.
 */

export function demoInvoiceLimits(config: Config): DailyLimits {
  return {
    perOrganization: config.demo.maxInvoicesPerVisitorPerDay,
    global: config.demo.maxInvoicesPerDay,
  };
}

/** Inicio del día de negocio en ISO: desde cuándo cuentan los topes del día. */
export function businessDayStart(config: Config, now: Date = new Date()): string {
  return startOfBusinessDay(now, config.displayTimeZone).toISOString();
}

/** Lanza `limit_reached` si la entrega supera un tope del día; una entrega repetida pasa. */
export async function assertDemoLimits(
  config: Config,
  db: Database,
  organizationId: Ulid,
  receiptKey: ReceiptKey,
): Promise<void> {
  await assertWithinDailyLimits(
    db,
    organizationId,
    demoInvoiceLimits(config),
    businessDayStart(config),
    receiptKey,
  );
}
