import { withWriteTransaction, type Database } from "@/src/db/client";
import {
  appendEvent,
  debitBalance,
  enqueueNotification,
  insertDecision,
  insertExtraction,
  reserveBudget,
  transitionInvoice,
  type InvoicePatch,
  type StoredExtraction,
} from "@/src/db/repositories";
import type {
  AuditEvent,
  Channel,
  Currency,
  Decision,
  Invoice,
  Notification,
  UlidGenerator,
  Verdict,
} from "@/src/domain";

/**
 * Registro de una decisión: todo lo que cambia por ella se escribe en una sola transacción
 * corta, o no se escribe nada (P-81). Las lecturas (ledger, saldos, historial) ya se
 * hicieron antes; aquí solo hay escrituras condicionales:
 *
 * - la transición de la factura por comparación y cambio, desde `procesando`;
 * - la extracción con la que se decidió;
 * - si se paga fuera del modo de prueba, la reserva de presupuesto y el débito de saldo,
 *   ambos `UPDATE` condicionales que fallan si ya no alcanza;
 * - la decisión, sus eventos y sus avisos en la cola.
 */

/** Cuánto vive un escalado sin resolver antes de vencer y pedir recordatorio. */
export const APPROVAL_TTL_DAYS = 7;

/** Lo que se compromete al pagar: presupuesto del periodo en USD y saldo en la moneda. */
export type Reservation = {
  readonly periodKey: string;
  readonly budgetCurrency: "USD";
  readonly usdCents: number;
  readonly currency: Currency;
  readonly amount: number;
};

export type DecisionRecord = {
  readonly invoice: Invoice;
  readonly decision: Decision;
  readonly patch: InvoicePatch;
  readonly extraction: StoredExtraction | null;
  readonly reservation: Reservation | null;
  readonly events: readonly AuditEvent[];
  readonly notifications: readonly Notification[];
};

/** Estado final de la factura según el veredicto: lo escalado espera a una persona. */
export function statusFor(verdict: Verdict): "decidida" | "esperando_aprobacion" {
  return verdict === "escalar" ? "esperando_aprobacion" : "decidida";
}

/** Vencimiento de la espera de aprobación, o null si la decisión no espera a nadie. */
export function approvalExpiry(verdict: Verdict, now: Date): string | null {
  if (verdict !== "escalar") return null;
  return new Date(now.getTime() + APPROVAL_TTL_DAYS * 86_400_000).toISOString();
}

/**
 * Avisos de una decisión: siempre en pantalla, y también por Telegram si la factura llegó
 * por ahí. La llave por decisión y canal hace que encolar dos veces deje un solo aviso.
 */
export function notificationsFor(input: {
  readonly decision: Decision;
  readonly invoice: Invoice;
  readonly channel: Channel;
  readonly newId: UlidGenerator;
  readonly nowIso: string;
}): Notification[] {
  const { decision, invoice } = input;
  const channels =
    input.channel === "telegram" ? (["pantalla", "telegram"] as const) : (["pantalla"] as const);
  return channels.map((channel) => ({
    id: input.newId(),
    organization_id: decision.organization_id,
    channel,
    idempotency_key: `decision:${decision.id}:${channel}`,
    payload: {
      invoice_id: invoice.id,
      decision_id: decision.id,
      reference: invoice.reference,
      verdict: decision.verdict,
    },
    status: "pendiente",
    attempts: 0,
    next_attempt_at: input.nowIso,
    last_error: null,
    created_at: input.nowIso,
    updated_at: input.nowIso,
  }));
}

/**
 * Escribe la decisión y todo lo que arrastra. Un `DbError` de `budget_exceeded` o
 * `insufficient_balance` significa que otra decisión comprometió lo que quedaba entre la
 * lectura y la escritura: no queda nada escrito y el caso de uso reevalúa con datos frescos.
 */
export async function recordDecision(db: Database, record: DecisionRecord): Promise<void> {
  const { invoice, decision } = record;
  const at = decision.decided_at;
  await withWriteTransaction(db, async (tx) => {
    await transitionInvoice(
      tx,
      invoice.organization_id,
      invoice.id,
      "procesando",
      statusFor(decision.verdict),
      at,
      record.patch,
    );
    if (record.extraction) await insertExtraction(tx, record.extraction);
    const r = record.reservation;
    if (r) {
      // Una conversión a USD que redondea a cero no compromete presupuesto, pero sí saldo.
      if (r.usdCents > 0) {
        await reserveBudget(
          tx,
          invoice.organization_id,
          r.periodKey,
          r.budgetCurrency,
          r.usdCents,
          at,
        );
      }
      await debitBalance(tx, invoice.organization_id, r.currency, r.amount, at);
    }
    await insertDecision(tx, decision);
    for (const event of record.events) await appendEvent(tx, event);
    for (const notification of record.notifications) await enqueueNotification(tx, notification);
  });
}
