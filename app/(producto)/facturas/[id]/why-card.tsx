import { formatMoney, toUsd, type FxTable } from "@/src/domain";
import { calendarDate, rateText } from "@/src/ui/format";
import { decisionSummary, reasonFor } from "@/src/ui/reasons";
import type { ExplanationRating, InvoiceDetail } from "@/src/usecases";

import { ExplanationFeedback } from "./explanation-feedback";

/** Color y fondo de la tarjeta "Por qué", según cómo terminó la factura. */
const WHY_TONE = {
  pagar: {
    text: "text-pay",
    box: "border-pay-solid/30 bg-linear-to-b from-pay-solid/11 to-pay-solid/3",
    rule: "border-pay-solid/22",
  },
  escalar: {
    text: "text-escalate",
    box: "border-escalate-solid/30 bg-linear-to-b from-escalate-solid/11 to-escalate-solid/3",
    rule: "border-escalate-solid/22",
  },
  frenar: {
    text: "text-hold",
    box: "border-hold-solid/30 bg-linear-to-b from-hold-solid/11 to-hold-solid/3",
    rule: "border-hold-solid/22",
  },
} as const;

/** Cuántos controles pasaron de los que aplican: "Pasó 18 de 19 controles." */
function passedText(passed: number, applicable: number, fromHistory: boolean): string {
  if (fromHistory) {
    return applicable === 0
      ? "Del historial de ejemplo: se decidió antes de la demo y no guarda el detalle de sus controles."
      : "Del historial de ejemplo: se decidió antes de la demo y solo guarda el control que la decidió.";
  }
  if (applicable === 0) return "Sin controles registrados.";
  return `Pasó ${String(passed)} de ${String(applicable)} ${applicable === 1 ? "control" : "controles"}.`;
}

/**
 * La decisión explicada para el cliente, arriba de todo (docs/interfaz.md §5.2): qué pasó,
 * por qué, en frases simples, y qué puede hacer. Sale de los mismos hallazgos registrados;
 * el registro técnico sigue más abajo para auditoría.
 */
export function WhyCard({
  detail,
  fx,
  rating,
}: {
  readonly detail: InvoiceDetail;
  readonly fx: FxTable;
  /** La opinión vigente sobre esta explicación, o null. */
  readonly rating: ExplanationRating | null;
}) {
  const { decision, invoice } = detail;
  if (!decision) return null;
  const findings = detail.rules.flatMap((rule) => (rule.finding ? [rule.finding] : []));
  const summary = decisionSummary(decision.verdict, invoice.status, findings);
  const tone =
    invoice.status === "rechazada"
      ? WHY_TONE.frenar
      : invoice.status === "aprobada"
        ? WHY_TONE.pagar
        : WHY_TONE[decision.verdict];
  // Primero lo que frena, luego lo que escala: así la razón de más peso va arriba.
  const reasons = [...findings]
    .sort((a, b) => (a.action === b.action ? 0 : a.action === "frenar" ? -1 : 1))
    // La llave es el hallazgo, no el título: dos campos con la misma regla dan el mismo título.
    .map((f, i) => ({ key: `${f.code}:${f.field ?? String(i)}`, ...reasonFor(f) }));
  const passed = detail.rules.filter((rule) => rule.outcome === "pass").length;
  const applicable = detail.rules.filter((rule) => rule.outcome !== "skipped").length;
  return (
    <section
      aria-label="Por qué"
      className={`grid gap-x-7 gap-y-5 rounded-[var(--radius-card)] border px-6 py-5.5 md:grid-cols-[minmax(0,1fr)_21rem] ${tone.box}`}
    >
      <div className="min-w-0 space-y-2.5">
        <p className={`caps ${tone.text}`}>Por qué</p>
        <p className="text-[22px] leading-7 font-bold tracking-[-0.01em] text-ink">
          {summary.headline}
        </p>
        {reasons.length > 0 ? (
          <ul className="space-y-1.5">
            {reasons.map((reason) => (
              <li key={reason.key} className="text-[14px] leading-[22px] text-ink-2">
                <span className="font-semibold text-ink">{reason.title}.</span> {reason.detail}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="text-[13px] text-ink-3">
          {passedText(passed, applicable, detail.fromHistory)}
        </p>
        {decision.amount && decision.amount.currency !== "USD" ? (
          <p className="text-[12px] text-ink-3">
            Para los límites en USD: {formatMoney(decision.amount)} ≈{" "}
            {formatMoney(toUsd(decision.amount, fx))}, con 1 USD ={" "}
            {rateText(fx.perUsd[decision.amount.currency])} {decision.amount.currency} (tasas fijas
            al {calendarDate(fx.asOf)}).
          </p>
        ) : null}
        <ExplanationFeedback invoiceId={invoice.id} decisionId={decision.id} current={rating} />
      </div>
      <div className={`space-y-2 md:border-l md:pl-7 ${tone.rule}`}>
        <p className="caps">Qué puedes hacer</p>
        <p className="text-[14px] leading-[22px] text-ink">{summary.next}</p>
      </div>
    </section>
  );
}
