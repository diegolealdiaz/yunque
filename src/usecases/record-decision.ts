import { withWriteTransaction, type Database } from "@/src/db/client";
import {
  appendEvent,
  debitBalance,
  enqueueNotification,
  findInvoicesBySemanticKey,
  getCurrentPolicy,
  insertDecision,
  insertExtraction,
  reserveBudget,
  transitionInvoice,
  type InvoicePatch,
  type StoredExtraction,
} from "@/src/db/repositories";
import {
  deliveredByBot,
  deliveredFromOutside,
  type AuditEvent,
  type Currency,
  type Decision,
  type Invoice,
  type Notification,
  type UlidGenerator,
  type Verdict,
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

/**
 * Lo que la evaluación dio por cierto cambió antes de escribir: otra versión de política
 * quedó vigente, u otra factura del mismo cobro se registró en paralelo. No se escribió
 * nada; el caso de uso reevalúa con datos frescos.
 */
export class DecisionRaceError extends Error {
  readonly reason: "policy_changed" | "duplicate_recorded";
  constructor(reason: DecisionRaceError["reason"]) {
    super(
      reason === "policy_changed"
        ? "La política cambió mientras se decidía"
        : "Otra factura del mismo cobro se registró mientras se decidía",
    );
    this.name = "DecisionRaceError";
    this.reason = reason;
  }
}

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

/**
 * Guarda contra el duplicado en paralelo: dos archivos distintos del mismo cobro que se
 * evalúan a la vez no se ven entre sí, porque la llave semántica se escribe con la decisión.
 */
export type DuplicateGuard = {
  readonly semanticKey: string;
  /** Inicio de la ventana de duplicados de la política (ISO). */
  readonly since: string;
};

export type DecisionRecord = {
  readonly invoice: Invoice;
  readonly decision: Decision;
  /** Solo en un `pagar`: el último chequeo de duplicados, ya dentro de la transacción. */
  readonly duplicateGuard: DuplicateGuard | null;
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
 * Avisos de una decisión (D24): siempre en pantalla, y también por Telegram cuando
 * - la factura llegó por el bot: el veredicto se responde en el chat, sea cual sea; o
 * - la empresa tiene un chat conectado, la factura la entregó una persona (subida, correo
 *   real o bot) y la decisión le importa: una escalada, una frenada o una aprobación.
 * Un pago que el agente hizo solo no interrumpe a nadie, y las facturas de ejemplo de la
 * demo no se avisan una por una: al terminar el lote va un resumen (`sendSampleSummary`).
 * La llave por decisión y canal hace que encolar dos veces deje un solo aviso.
 */
export function notificationsFor(input: {
  readonly decision: Decision;
  readonly invoice: Invoice;
  /** La empresa tiene al menos un chat de Telegram conectado. */
  readonly telegramLinked: boolean;
  readonly newId: UlidGenerator;
  readonly nowIso: string;
}): Notification[] {
  const { decision, invoice } = input;
  const matters = decision.verdict !== "pagar" || decision.actor.kind === "humano";
  const telegram =
    deliveredByBot(invoice.receipt_key) ||
    (input.telegramLinked && deliveredFromOutside(invoice.receipt_key) && matters);
  const channels = telegram ? (["pantalla", "telegram"] as const) : (["pantalla"] as const);
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
 * Escribe la decisión y todo lo que arrastra. Las escrituras se serializan, así que lo que
 * otra decisión confirmó antes ya se ve aquí. Si algo de lo evaluado cambió, no se escribe
 * nada y el caso de uso reevalúa con datos frescos:
 * - `DecisionRaceError`: otra política vigente u otro registro del mismo cobro;
 * - `DbError` de `budget_exceeded` o `insufficient_balance`: otra decisión comprometió lo
 *   que quedaba de presupuesto o de saldo.
 */
export async function recordDecision(db: Database, record: DecisionRecord): Promise<void> {
  const { invoice, decision } = record;
  const at = decision.decided_at;
  await withWriteTransaction(db, async (tx) => {
    // El interruptor de pagos y los límites se consultan en cada decisión, no al empezar.
    const policy = await getCurrentPolicy(tx, invoice.organization_id);
    if (policy?.id !== decision.policy_version_id) throw new DecisionRaceError("policy_changed");
    const guard = record.duplicateGuard;
    if (guard) {
      const others = await findInvoicesBySemanticKey(
        tx,
        invoice.organization_id,
        guard.semanticKey,
        guard.since,
        invoice.id,
      );
      if (others.some((other) => other.status !== "rechazada")) {
        throw new DecisionRaceError("duplicate_recorded");
      }
    }
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
