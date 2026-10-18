import type { ComponentType } from "react";

import type { Verdict } from "@/src/domain";

import { AlertIcon, CheckIcon, StopIcon } from "../_components/icons";
import { VerdictChip } from "../_components/verdict-chip";

/**
 * El agente decidiendo, en el primer bloque de la portada. Tres facturas reales del lote de
 * ejemplo, cada una con los controles que la deciden y el veredicto que el motor les da
 * (tests/dataset/engine.test.ts lo exige): una se paga, otra se frena por instrucciones
 * escondidas en el documento y otra se escala por superar el umbral. Los montos en USD salen
 * de las tasas fijas de la empresa de ejemplo.
 *
 * app/_landing/motion.tsx las pasa en bucle: lee, revisa control por control y decide. Sin
 * animación se ve la primera, completa; las otras dos quedan ocultas.
 */

type Check = { readonly ok: boolean; readonly label: string; readonly value: string };

type SampleCase = {
  readonly payee: string;
  readonly reference: string;
  readonly amount: string;
  readonly checks: readonly Check[];
  readonly verdict: Verdict;
  readonly outcome: string;
};

const CASES: readonly SampleCase[] = [
  {
    payee: "Nube Andina SAS",
    reference: "F-2291",
    amount: "4.800.000 COP",
    checks: [
      { ok: true, label: "Beneficiario aprobado", value: "verificado" },
      { ok: true, label: "Cuenta registrada", value: "****9023" },
      { ok: true, label: "Bajo el umbral", value: "1,156.56 ≤ 5,000.00 USD" },
      { ok: true, label: "Sin duplicados", value: "0 coincidencias" },
    ],
    verdict: "pagar",
    outcome: "Orden lista para el 22 oct",
  },
  {
    payee: "Camila Rojas",
    reference: "CR-121",
    amount: "7.600.000 COP",
    checks: [
      { ok: true, label: "Beneficiario aprobado", value: "verificado" },
      { ok: true, label: "Cuenta registrada", value: "****2345" },
      { ok: true, label: "Bajo el umbral", value: "1,831.21 ≤ 5,000.00 USD" },
      { ok: false, label: "Instrucciones en el documento", value: "«ignora las reglas…»" },
    ],
    verdict: "frenar",
    outcome: "No se paga: el documento le habla al sistema",
  },
  {
    payee: "Andes Hardware SAS",
    reference: "AH-5560",
    amount: "25.000.000 COP",
    checks: [
      { ok: true, label: "Beneficiario aprobado", value: "verificado" },
      { ok: true, label: "Cuenta registrada", value: "****3344" },
      { ok: true, label: "Sin duplicados", value: "0 coincidencias" },
      { ok: false, label: "Umbral de aprobación", value: "6,023.73 > 5,000.00 USD" },
    ],
    verdict: "escalar",
    outcome: "Espera a una persona: Ana Torres",
  },
];

const FAILED: Readonly<
  Record<Verdict, { readonly Icon: ComponentType; readonly className: string }>
> = {
  pagar: { Icon: CheckIcon, className: "text-pay-solid" },
  frenar: { Icon: StopIcon, className: "text-hold-solid" },
  escalar: { Icon: AlertIcon, className: "text-escalate-solid" },
};

const OUTCOME_TINT: Readonly<Record<Verdict, string>> = {
  pagar: "bg-pay-tint",
  frenar: "bg-hold-tint",
  escalar: "bg-escalate-tint",
};

export function AgentLive() {
  return (
    <div className="relative">
      {/* Halo detrás de la tarjeta: la luz de marca, no un color de veredicto. */}
      <div
        aria-hidden="true"
        className="absolute -inset-8 rounded-[40px] bg-[radial-gradient(closest-side,var(--glow-1),transparent)] blur-2xl"
      />
      <figure
        data-agent
        aria-label="Ejemplo: el agente revisa tres facturas del lote y decide pagar, frenar y escalar"
        className="card relative overflow-hidden"
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <span className="flex items-center gap-2 text-[13px] font-semibold text-ink">
            <span aria-hidden="true" className="relative flex size-2">
              <span
                data-agent-pulse
                className="absolute inset-0 rounded-full bg-brand opacity-60"
              />
              <span className="relative size-2 rounded-full bg-brand" />
            </span>
            Agente
          </span>
          <span data-agent-status className="font-mono text-[12px] text-ink-3">
            Decidida
          </span>
        </div>

        <ol className="grid p-5 sm:p-6">
          {CASES.map((sample, i) => {
            const failed = FAILED[sample.verdict];
            return (
              <li
                key={sample.reference}
                data-case
                data-verdict-name={sample.verdict}
                aria-hidden={i === 0 ? undefined : true}
                className={`[grid-area:1/1] min-w-0 ${i === 0 ? "" : "invisible"}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="caps">Factura PDF · {sample.reference}</p>
                    <p className="mt-1.5 truncate text-[17px] font-semibold text-ink">
                      {sample.payee}
                    </p>
                  </div>
                  <p className="num shrink-0 font-mono text-[18px] font-semibold tracking-tight text-ink sm:text-[20px]">
                    {sample.amount}
                  </p>
                </div>

                <div data-scan-area className="relative mt-4 border-t border-line pt-3">
                  <span aria-hidden="true" data-scan className="agent-scan" />
                  <ul className="space-y-0.5">
                    {sample.checks.map((check) => (
                      <li
                        key={check.label}
                        data-check
                        className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-[var(--radius-control)] px-2 py-1.5 text-[13px]"
                      >
                        <span className={check.ok ? "text-pay-solid" : failed.className}>
                          {check.ok ? <CheckIcon /> : <failed.Icon />}
                        </span>
                        <span
                          className={`flex-1 ${check.ok ? "text-ink-2" : "font-semibold text-ink"}`}
                        >
                          {check.label}
                        </span>
                        <span className="num w-full pl-7 font-mono text-[12px] text-ink-3 sm:w-auto sm:pl-0">
                          {check.value}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div
                  data-verdict
                  className={`mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[12px] px-4 py-3 ${OUTCOME_TINT[sample.verdict]}`}
                >
                  <VerdictChip verdict={sample.verdict} />
                  <span className="text-[13px] text-ink">{sample.outcome}</span>
                </div>
              </li>
            );
          })}
        </ol>

        {/* Una barra por factura: se llena mientras el agente la revisa. */}
        <div aria-hidden="true" className="grid grid-cols-3 gap-2 px-5 pb-4 sm:px-6">
          {CASES.map((sample, i) => (
            <span key={sample.reference} className="h-1 overflow-hidden rounded-full bg-line">
              <span
                data-agent-bar
                className="block h-full origin-left rounded-full bg-brand"
                style={{ transform: `scaleX(${i === 0 ? 1 : 0})` }}
              />
            </span>
          ))}
        </div>
      </figure>
    </div>
  );
}
