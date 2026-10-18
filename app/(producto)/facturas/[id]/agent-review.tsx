import { usdMicros } from "@/src/ui/format";
import { FIELD_LABEL, ruleTitle } from "@/src/ui/labels";
import { reasonFor } from "@/src/ui/reasons";
import type { InvoiceDetail, RuleTrace } from "@/src/usecases";

import { ConfidenceDot } from "../../../_components/confidence-dot";
import { EvidenceTarget } from "../../../_components/document-viewer";
import { AlertIcon, CheckIcon, StopIcon } from "../../../_components/icons";

import { SubTitle, displayValue } from "./parts";

/**
 * La columna "Lo que leyó y revisó el agente": los campos con su confianza (cada uno señala
 * su evidencia en el documento), los controles con los que fallaron primero, y el registro
 * técnico para auditoría.
 */
export function AgentReview({ detail }: { readonly detail: InvoiceDetail }) {
  const { decision } = detail;
  return (
    <>
      <ReadFields detail={detail} />
      <RuleList detail={detail} />
      {decision ? (
        <>
          <details className="text-[13px]">
            <summary className="cursor-pointer caps">Registro técnico (auditoría)</summary>
            <p className="mt-2 font-mono text-[12px] leading-relaxed whitespace-pre-line text-ink-2">
              {decision.explanation}
            </p>
          </details>
          <p className="text-[12px] text-ink-3">
            Costo de lectura: {usdMicros(decision.cost_usd_micros)} · política v
            {detail.policyVersion ?? "?"}
          </p>
        </>
      ) : null}
    </>
  );
}

function ReadFields({ detail }: { readonly detail: InvoiceDetail }) {
  const currency =
    detail.extraction?.extraction.kind === "invoice"
      ? detail.extraction.extraction.fields.currency.value
      : null;
  return (
    <div className="space-y-1">
      <SubTitle>Campos</SubTitle>
      {detail.fields.length === 0 ? (
        <p className="text-[13px] text-ink-2">El agente no pudo leer campos de este documento.</p>
      ) : (
        detail.fields.map((field) => (
          <EvidenceTarget key={field.name} id={field.name}>
            <span className="grid grid-cols-[7rem_minmax(0,1fr)_auto] items-center gap-2 text-[13px]">
              <span className="text-ink-2">{FIELD_LABEL[field.name]}</span>
              <span className="truncate font-mono text-ink">
                {displayValue(field, currency)}
                {field.source === "humano" ? (
                  <span className="ml-1.5 rounded-sm border border-line-strong px-1 font-sans text-[11px] text-ink-2">
                    a mano
                  </span>
                ) : null}
              </span>
              <ConfidenceDot confidence={field.confidence} minimum={detail.minConfidence} />
            </span>
          </EvidenceTarget>
        ))
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
  return (
    <div>
      <SubTitle>
        {detail.rulesFromEscalation ? "Controles de la escalada aprobada" : "Controles"}
      </SubTitle>
      <ul className="mt-1">
        {failed.map((rule) => (
          <RuleRow key={rule.code} rule={rule} />
        ))}
      </ul>
      {others.length > 0 ? (
        <details className="mt-1 text-[13px]">
          <summary className="cursor-pointer text-ink-2">
            {others.length} controles más, en orden
          </summary>
          <ul>
            {others.map((rule) => (
              <RuleRow key={rule.code} rule={rule} />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/** Cómo se ve una regla que falló, según lo que hace: frenar o escalar. Siempre con texto. */
const FAILED_STYLE = {
  frenar: { Icon: StopIcon, className: "text-hold-solid", label: "no pasó · la frena" },
  escalar: { Icon: AlertIcon, className: "text-escalate-solid", label: "no pasó · la escala" },
} as const;

function RuleRow({ rule }: { readonly rule: RuleTrace }) {
  // Una regla que no se pudo evaluar frena (rule_error): es lo más estricto.
  const style = isFailed(rule) ? FAILED_STYLE[rule.finding?.action ?? "frenar"] : null;
  const Icon = style?.Icon ?? CheckIcon;
  const status = style?.label ?? (rule.outcome === "skipped" ? "no aplicó" : "pasó");
  return (
    <li className="grid grid-cols-[1.25rem_1fr] gap-x-2 py-1 text-[13px]">
      <span aria-hidden="true" className={style?.className ?? "text-ink-3"}>
        <Icon />
      </span>
      <span>
        <span className="text-ink">
          {rule.finding ? reasonFor(rule.finding).title : ruleTitle(rule.code)}
        </span>
        <span className={style ? `font-medium ${style.className}` : "text-ink-3"}> · {status}</span>
        {rule.finding ? (
          <span className="block text-[12px] text-ink-3">
            observado {rule.finding.observed} · umbral {rule.finding.threshold} ·{" "}
            <span className="font-mono">{rule.code}</span>
          </span>
        ) : null}
      </span>
    </li>
  );
}
