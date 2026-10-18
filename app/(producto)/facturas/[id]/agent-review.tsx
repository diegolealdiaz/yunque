import { maskAccount, type Vendor, type Verdict } from "@/src/domain";
import { usdMicros } from "@/src/ui/format";
import { FIELD_LABEL, FIELD_SOURCE_CHIP, RAIL_LABEL, ruleTitle } from "@/src/ui/labels";
import { reasonFor } from "@/src/ui/reasons";
import type { InvoiceDetail, RuleTrace } from "@/src/usecases";

import { ConfidenceDot } from "../../../_components/confidence-dot";
import { EvidenceTarget } from "../../../_components/document-viewer";
import { AlertIcon, CheckIcon, StopIcon } from "../../../_components/icons";

import { SubTitle, displayValue } from "./parts";

/**
 * La columna "Lo que leyó y revisó el agente": los campos con su confianza (cada uno señala
 * su evidencia en el documento, y el que hizo fallar un control va resaltado), los controles
 * que fallaron a la vista y los demás plegados, y el registro técnico para auditoría.
 */
export function AgentReview({ detail }: { readonly detail: InvoiceDetail }) {
  const { decision } = detail;
  return (
    <>
      <ReadFields detail={detail} />
      <RuleList detail={detail} />
      {decision ? (
        <div className="space-y-2 border-t border-line pt-3">
          <details className="text-[13px]">
            <summary className="caps cursor-pointer">Registro técnico (auditoría)</summary>
            <p className="mt-2 font-mono text-[12px] leading-relaxed whitespace-pre-line text-ink-2">
              {decision.explanation}
            </p>
          </details>
          <p className="text-[12px] text-ink-3">
            Costo de lectura: {usdMicros(decision.cost_usd_micros)} · política v
            {detail.policyVersion ?? "?"}
          </p>
        </div>
      ) : null}
    </>
  );
}

/** Tinte de la fila de un campo que hizo fallar un control, según lo que hace el control. */
const FLAG_TINT: Readonly<Record<Exclude<Verdict, "pagar">, string>> = {
  escalar: "bg-escalate-solid/12",
  frenar: "bg-hold-solid/12",
};

/**
 * La cuenta registrada del beneficiario bajo la que trae el documento, para comparar sin ir a
 * otra pantalla. Enmascarada: los números completos no se muestran.
 */
function RegisteredAccount({ read, vendor }: { readonly read: string; readonly vendor: Vendor }) {
  const digits = (text: string) => text.replace(/[^A-Za-z0-9]+/g, "").toUpperCase();
  const same = digits(read) === digits(vendor.account.account_number);
  const registered = `${RAIL_LABEL[vendor.account.rail]} ${maskAccount(vendor.account.account_number)}`;
  return (
    <p className={`pb-2 pl-[8.25rem] text-[12px] ${same ? "text-ink-3" : "font-medium text-hold"}`}>
      {same
        ? `Es la registrada de ${vendor.name}: ${registered}`
        : `No es la registrada de ${vendor.name}: ${registered}`}
    </p>
  );
}

function ReadFields({ detail }: { readonly detail: InvoiceDetail }) {
  const currency =
    detail.extraction?.extraction.kind === "invoice"
      ? detail.extraction.extraction.fields.currency.value
      : null;
  // El campo de cada control que falló, con lo que hace ese control: la fila se resalta.
  const flagged = new Map<string, Exclude<Verdict, "pagar">>();
  for (const rule of detail.rules) {
    const finding = rule.finding;
    if (finding?.field && isFailed(rule) && !flagged.has(finding.field)) {
      flagged.set(finding.field, finding.action);
    }
  }
  return (
    <div>
      <SubTitle>Campos</SubTitle>
      {detail.fields.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-2">
          El agente no pudo leer campos de este documento.
        </p>
      ) : (
        <ul className="mt-1">
          {detail.fields.map((field) => {
            const flag = flagged.get(field.name);
            return (
              <li
                key={field.name}
                className={`border-b border-line last:border-b-0 ${
                  flag ? `-mx-2.5 rounded-[var(--radius-control)] px-2.5 ${FLAG_TINT[flag]}` : ""
                }`}
              >
                <EvidenceTarget id={field.name}>
                  <span className="grid h-9 grid-cols-[7.5rem_minmax(0,1fr)_auto] items-center gap-3 text-[13px]">
                    <span className="text-ink-3">{FIELD_LABEL[field.name]}</span>
                    <span
                      className={`truncate text-ink ${field.name === "payee_name" ? "" : "font-mono"} ${flag ? "font-semibold" : ""}`}
                    >
                      {displayValue(field, currency)}
                      {field.source === "modelo" ? null : (
                        <span className="ml-1.5 rounded-sm border border-line-strong px-1 font-sans text-[11px] font-normal text-ink-2">
                          {FIELD_SOURCE_CHIP[field.source]}
                        </span>
                      )}
                    </span>
                    <ConfidenceDot confidence={field.confidence} minimum={detail.minConfidence} />
                  </span>
                </EvidenceTarget>
                {field.name === "bank_account" && detail.vendor ? (
                  <RegisteredAccount read={String(field.value)} vendor={detail.vendor} />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function isFailed(rule: RuleTrace): boolean {
  return rule.outcome === "fail" || rule.outcome === "error";
}

/** Los controles que fallaron, a la vista; los demás, plegados y en orden. */
function RuleList({ detail }: { readonly detail: InvoiceDetail }) {
  const failed = detail.rules.filter(isFailed);
  const others = detail.rules.filter((rule) => !isFailed(rule));
  const passed = others.filter((rule) => rule.outcome === "pass").length;
  const skipped = others.length - passed;
  const summary =
    (failed.length > 0 ? `${String(others.length)} controles más` : "Todos en orden") +
    `: ${String(passed)} ${passed === 1 ? "pasó" : "pasaron"}` +
    (skipped > 0 ? `, ${String(skipped)} no ${skipped === 1 ? "aplicó" : "aplicaron"}` : "");
  return (
    <div>
      <SubTitle>
        {detail.rulesFromEscalation ? "Controles de la escalada aprobada" : "Controles"}
      </SubTitle>
      {detail.fromHistory ? (
        <p className="mt-2 text-[13px] text-ink-2">
          {detail.rules.length === 0
            ? "Del historial de ejemplo: se decidió antes de la demo y no guarda el detalle de sus controles."
            : "Del historial de ejemplo: solo guarda el control que la decidió."}
        </p>
      ) : detail.rules.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-2">Sin controles registrados.</p>
      ) : null}
      {failed.length > 0 ? (
        <ul className="mt-1">
          {failed.map((rule) => (
            <RuleRow key={rule.code} rule={rule} documentText={detail.invoice.text} />
          ))}
        </ul>
      ) : null}
      {others.length > 0 ? (
        <details className="group text-[13px]">
          <summary className="flex h-10 cursor-pointer list-none items-center gap-2.5">
            <CheckIcon className="shrink-0 text-pay-solid" />
            <span className="flex-1 text-ink-2">{summary}</span>
            <span className="text-ink-2 underline decoration-1 underline-offset-[3px]">
              <span className="group-open:hidden">Ver todos</span>
              <span className="hidden group-open:inline">Ocultar</span>
            </span>
          </summary>
          <ul className="pb-1">
            {others.map((rule) => (
              <RuleRow key={rule.code} rule={rule} documentText={detail.invoice.text} />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/** Cómo se ve una regla que falló, según lo que hace: frenar o escalar. Siempre con texto. */
const FAILED_STYLE = {
  frenar: { Icon: StopIcon, className: "text-hold-solid", label: "la frena" },
  escalar: { Icon: AlertIcon, className: "text-escalate-solid", label: "la escala" },
} as const;

function RuleRow({
  rule,
  documentText,
}: {
  readonly rule: RuleTrace;
  /** Texto del documento: dice si una cita salió del PDF o del mensaje que lo trajo. */
  readonly documentText: string | null;
}) {
  // Una regla que no se pudo evaluar frena (rule_error): es lo más estricto.
  const style = isFailed(rule) ? FAILED_STYLE[rule.finding?.action ?? "frenar"] : null;
  const Icon = style?.Icon ?? CheckIcon;
  const title = rule.finding
    ? reasonFor(rule.finding, { documentText }).title
    : ruleTitle(rule.code);
  if (!style) {
    return (
      <li className="flex items-center gap-2.5 py-1.5 text-[13px]">
        <span aria-hidden="true" className="text-ink-3">
          <Icon />
        </span>
        <span className="flex-1 text-ink-2">{title}</span>
        <span className="text-[12px] text-ink-3">
          {rule.outcome === "skipped" ? "no aplicó" : "pasó"}
        </span>
      </li>
    );
  }
  return (
    <li className="flex gap-2.5 border-b border-line py-2.5 text-[13px]">
      <span aria-hidden="true" className={`mt-px ${style.className}`}>
        <Icon />
      </span>
      <span className="min-w-0 space-y-0.5">
        <span className="block font-semibold text-ink">
          {title}
          <span className="sr-only"> · no pasó, {style.label}</span>
        </span>
        {rule.finding ? (
          <span className="block font-mono text-[11px] leading-[14px] text-ink-3">
            observado {rule.finding.observed} · umbral {rule.finding.threshold} · {rule.code}
          </span>
        ) : null}
      </span>
    </li>
  );
}
