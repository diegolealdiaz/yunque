import Link from "next/link";

import { instant } from "@/src/ui/format";
import { HEALTH_STATUS_LABEL, healthRows } from "@/src/ui/health";
import type { HealthStatus } from "@/src/usecases";

import { CheckIcon, StopIcon } from "../../_components/icons";
import { PageHeader } from "../../_components/page-header";
import { appContext } from "../../_data/context";
import { healthReport } from "../../_data/health";

export const metadata = { title: "Salud · Yunque" };

/**
 * Salud (docs/interfaz.md §5.7): base, política, proveedor del modelo, pendiente más viejo,
 * escaladas abiertas y avisos fallidos. Verde o rojo por fila, siempre con icono y texto.
 * Es lo mismo que responde `/api/health`, en pantalla.
 */

const STATUS_STYLE: Readonly<Record<HealthStatus, string>> = {
  ok: "bg-pay-tint text-pay",
  degradada: "bg-escalate-tint text-escalate",
  falla: "bg-hold-tint text-hold",
};

export default async function SaludPage() {
  const { config, organization } = await appContext();
  const report = await healthReport(() => Promise.resolve(organization.id));
  const now = new Date(report.checkedAt);
  const rows = healthRows(report, now);

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Salud"
        meta={<span>Revisada {instant(report.checkedAt, config.displayTimeZone)}</span>}
        actions={
          <span
            className={`inline-flex h-6 items-center rounded-[var(--radius-control)] px-2 text-[12px] font-semibold ${STATUS_STYLE[report.status]}`}
          >
            {HEALTH_STATUS_LABEL[report.status]}
          </span>
        }
      />
      <ul className="divide-y divide-line card">
        {rows.map((row) => (
          <li key={row.key} className="flex items-start gap-3 px-4 py-3">
            <span
              className={`mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full ${row.ok ? "bg-pay-tint text-pay" : "bg-hold-tint text-hold"}`}
            >
              {row.ok ? <CheckIcon /> : <StopIcon />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium text-ink">
                {row.label}{" "}
                <span className={`text-[12px] font-normal ${row.ok ? "text-pay" : "text-hold"}`}>
                  · {row.ok ? "en orden" : "falla"}
                </span>
              </p>
              <p className="mt-0.5 text-[13px] text-ink-2">{row.detail}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="text-[13px] text-ink-3">
        Lo mismo en JSON para un monitor:{" "}
        <Link
          href="/api/health"
          prefetch={false}
          className="font-mono text-ink-2 underline underline-offset-4"
        >
          /api/health
        </Link>
        . Responde 503 si falla la base, la política o el proveedor.
      </p>
    </div>
  );
}
