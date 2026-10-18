import { formatMoney, toUsd, type FxTable } from "@/src/domain";
import { calendarDate, rateText } from "@/src/ui/format";
import { decisionSummary, reasonFor } from "@/src/ui/reasons";
import type { ExplanationRating, InvoiceDetail } from "@/src/usecases";

import { AlertIcon, CheckIcon, StopIcon } from "../../../_components/icons";

import { ExplanationFeedback } from "./explanation-feedback";

/** Color, icono y borde de la tarjeta "Por qué", según cómo terminó la factura. */
const WHY_TONE = {
  pagar: {
    Icon: CheckIcon,
    text: "text-pay",
    box: "border-pay-solid/35 bg-linear-to-r from-pay-tint to-pay-tint/30",
  },
  escalar: {
    Icon: AlertIcon,
    text: "text-escalate",
    box: "border-escalate-solid/35 bg-linear-to-r from-escalate-tint to-escalate-tint/30",
  },
  frenar: {
    Icon: StopIcon,
    text: "text-hold",
    box: "border-hold-solid/35 bg-linear-to-r from-hold-tint to-hold-tint/30",
  },
} as const;

/** La frase de los controles que pasaron, contando las razones ya listadas arriba. */
function passedText(passed: number, reasons: number): string {
  if (passed === 0) {
    return "Factura del historial de ejemplo: llegó ya decidida, sin el detalle de sus controles.";
  }
  if (reasons === 0) return `Pasó los ${String(passed)} controles que aplican.`;
  return passed === 1
    ? "Pasó el otro control que aplica."
    : `Pasó los otros ${String(passed)} controles.`;
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
  const { Icon } = tone;
  return (
    <section
      aria-label="Por qué"
      className={`rounded-[var(--radius-card)] border px-6 py-5 ${tone.box}`}
    >
      <p className={`caps ${tone.text}`}>Por qué</p>
      <p className="mt-2 flex items-center gap-2 text-[20px] font-bold tracking-tight text-ink">
        <Icon className={`size-5 shrink-0 ${tone.text}`} />
        {summary.headline}
      </p>
      {reasons.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {reasons.map((reason) => (
            <li key={reason.key} className="text-[14px] leading-relaxed">
              <span className="font-semibold text-ink">{reason.title}.</span>{" "}
              <span className="text-ink-2">{reason.detail}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-3 text-[13px] text-ink-2">{passedText(passed, reasons.length)}</p>
      <p className="mt-1 text-[14px] text-ink">
        <span className="font-semibold">Qué puedes hacer:</span> {summary.next}
      </p>
      {decision.amount && decision.amount.currency !== "USD" ? (
        <p className="mt-2 text-[12px] text-ink-3">
          Para los límites en USD: {formatMoney(decision.amount)} ≈{" "}
          {formatMoney(toUsd(decision.amount, fx))}, con 1 USD ={" "}
          {rateText(fx.perUsd[decision.amount.currency])} {decision.amount.currency} (tasas fijas al{" "}
          {calendarDate(fx.asOf)}).
        </p>
      ) : null}
      <ExplanationFeedback invoiceId={invoice.id} decisionId={decision.id} current={rating} />
    </section>
  );
}
