import { AlertIcon, CheckIcon, StopIcon } from "../_components/icons";
import { VerdictChip } from "../_components/verdict-chip";

/**
 * La pieza de la portada que muestra el producto sin abrirlo: una factura escalada con sus
 * controles (valor observado contra umbral, en mono) y, debajo, una pagada y una frenada.
 * Son casos del lote de ejemplo, escritos como texto: no lee la base. La entrada
 * (app/_landing/motion.tsx) muestra los controles uno tras otro, como los revisa el agente,
 * y al final cruza un brillo; sin animación, todo está en su lugar desde el inicio.
 */

const CHECKS = [
  { ok: true, label: "Monto dentro del umbral", value: "1,156.56 ≤ 5,000.00 USD" },
  { ok: true, label: "Sin duplicados en 90 días", value: "0 coincidencias" },
  { ok: true, label: "Cabe en el presupuesto", value: "62 % de octubre" },
  { ok: false, label: "Cuenta distinta a la registrada", value: "****4471 ≠ ****9023" },
] as const;

export function DecisionPreview() {
  return (
    <div className="relative" data-hero-card>
      {/* Halo detrás de la tarjeta: la luz de marca, no un color de veredicto. */}
      <div
        aria-hidden="true"
        className="absolute -inset-6 rounded-[32px] bg-[radial-gradient(closest-side,var(--glow-1),transparent)] blur-2xl"
      />
      <figure
        aria-label="Ejemplo de una decisión de Yunque"
        data-intro="card"
        className="card relative overflow-hidden p-5 sm:p-6"
      >
        <span aria-hidden="true" data-intro="shine" className="card-shine" />
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="caps">Factura recibida por correo</p>
            <p className="mt-1.5 truncate text-[17px] font-semibold text-ink">Nube Andina SAS</p>
            <p className="font-mono text-[12px] text-ink-3">F-2291 · vence en 2 días</p>
          </div>
          <p className="num shrink-0 font-mono text-[20px] font-semibold tracking-tight text-ink">
            4.800.000 COP
          </p>
        </div>

        <ul className="mt-5 space-y-1 border-t border-line pt-4">
          {CHECKS.map((check) => (
            <li
              key={check.label}
              data-intro="check"
              className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-[var(--radius-control)] px-2 py-1.5 text-[13px]"
            >
              <span className={check.ok ? "text-pay-solid" : "text-escalate-solid"}>
                {check.ok ? <CheckIcon /> : <AlertIcon />}
              </span>
              <span className={`flex-1 ${check.ok ? "text-ink-2" : "font-semibold text-ink"}`}>
                {check.label}
              </span>
              <span className="num w-full pl-7 font-mono text-[12px] text-ink-3 sm:w-auto sm:pl-0">
                {check.value}
              </span>
            </li>
          ))}
        </ul>

        <div
          data-intro="verdict"
          className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[12px] bg-escalate-tint px-4 py-3"
        >
          <VerdictChip verdict="escalar" />
          <span className="text-[13px] text-ink">
            Espera a una persona: <span className="font-semibold">Ana Torres</span>
          </span>
        </div>
      </figure>

      <div className="relative mt-3 grid gap-3 sm:grid-cols-2">
        <div data-intro="card" className="card flex items-center gap-3 px-4 py-3 text-[13px]">
          <span className="text-pay-solid">
            <CheckIcon />
          </span>
          <span className="min-w-0 flex-1 truncate text-ink">Andes Hardware SAS</span>
          <span className="font-mono text-[12px] font-semibold text-pay">PAGADA</span>
        </div>
        <div data-intro="card" className="card flex items-center gap-3 px-4 py-3 text-[13px]">
          <span className="text-hold-solid">
            <StopIcon />
          </span>
          <span className="min-w-0 flex-1 truncate text-ink">Duplicada de FAC-0412</span>
          <span className="font-mono text-[12px] font-semibold text-hold">FRENADA</span>
        </div>
      </div>
    </div>
  );
}
