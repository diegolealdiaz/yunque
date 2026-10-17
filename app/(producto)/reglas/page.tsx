import { cookies } from "next/headers";

import { CURRENCIES, formatMoney, money, policyEditToYaml, type FxTable } from "@/src/domain";
import { APPROVER_COOKIE, verifyApprover } from "@/src/session";
import { loadPolicyHistory } from "@/src/usecases";
import { calendarDate, instant, rateText } from "@/src/ui/format";

import { ApproverPicker } from "../../_components/approver-picker";
import { PageHeader } from "../../_components/page-header";
import { EmptyState } from "../../_components/states";
import { appContext } from "../../_data/context";

import { ControlsPanel } from "./controls-panel";
import { PolicyWorkbench } from "./policy-workbench";

export const metadata = { title: "Reglas · Yunque" };

/** Guardar reevalúa las facturas abiertas en la misma acción: se le da margen. */
export const maxDuration = 60;

/**
 * Reglas (docs/interfaz.md §5.4): quién firma en el encabezado, los interruptores de control
 * y la política en pestañas (formulario, código y versiones), para que todo quepa en una
 * pantalla. "Ver qué cambiaría" muestra el efecto de un cambio antes de guardarlo.
 */
/**
 * Las tasas con que se convierte a USD para comparar con los límites, de solo lectura
 * (D22): fijas por empresa en esta versión. Cambiarlas cambiaría qué se paga, así que no se
 * editan desde aquí; en producción vendrán de un proveedor diario y cada decisión guardará
 * la tasa que usó.
 */
function RatesTable({ fx }: { readonly fx: FxTable }) {
  const others = CURRENCIES.filter((currency) => currency !== "USD");
  return (
    <div className="max-w-xl space-y-2">
      <p className="text-[13px] text-ink-2">
        Los límites, el umbral y el presupuesto van en USD. Una factura en otra moneda se convierte
        con estas tasas y se compara sin redondear. Son fijas desde el {calendarDate(fx.asOf)} y no
        se editan aquí: cambiarlas cambiaría qué se paga.
      </p>
      <table className="w-full card text-[13px]">
        <caption className="sr-only">Tasas de cambio por 1 USD</caption>
        <thead>
          <tr className="border-b border-line text-left text-[12px] text-ink-2">
            <th scope="col" className="h-8 px-3 font-medium">
              Moneda
            </th>
            <th scope="col" className="h-8 px-3 text-right font-medium">
              1 USD equivale a
            </th>
          </tr>
        </thead>
        <tbody>
          {others.map((currency) => (
            <tr
              key={currency}
              className="h-[var(--row-height)] border-b border-line last:border-b-0"
            >
              <td className="px-3 font-mono text-ink">{currency}</td>
              <td className="num px-3 text-right text-ink">
                {rateText(fx.perUsd[currency])} {currency}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function ReglasPage() {
  const { config, db, organization } = await appContext();
  const { current, versions, lastReplay: replayed } = await loadPolicyHistory(db, organization.id);
  if (!current) {
    return (
      <EmptyState
        title="La empresa no tiene política vigente"
        detail="Sin política no hay mandato: ninguna factura se decide hasta guardar una."
      />
    );
  }
  const approver = verifyApprover(
    (await cookies()).get(APPROVER_COOKIE)?.value,
    config.secrets.session,
  );
  const signer =
    approver !== null && current.content.protected.approvers.includes(approver) ? approver : null;
  const { protected: locked } = current.content;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Reglas"
        meta={
          <span className="text-[12px] text-ink-3">
            Demo sin inicio de sesión: elige qué aprobador firma.
          </span>
        }
        actions={
          <div className="w-64">
            <ApproverPicker
              approvers={locked.approvers}
              approver={signer}
              path="/reglas"
              label="Firmas como"
              inline
            />
          </div>
        }
      />

      {replayed ? (
        <p
          role="status"
          className="rounded-[var(--radius-control)] bg-surface-sunken px-3 py-2 text-[12px] text-ink-2"
        >
          Última reevaluación: v{replayed.version} guardada por {replayed.who} ·{" "}
          {instant(replayed.at, config.displayTimeZone)} · {replayed.reevaluated} facturas abiertas
          reevaluadas, {replayed.changed} cambiaron de veredicto.
        </p>
      ) : null}

      <ControlsPanel controls={current.content.controls} canSign={signer !== null} />

      <PolicyWorkbench
        // Se vuelve a montar con cada versión nueva para partir de lo guardado.
        key={current.id}
        initialYaml={policyEditToYaml(current.content)}
        version={current.version}
        signedBy={current.signed_by}
        canSign={signer !== null}
        protectedKeys={[
          {
            label: "Tope absoluto del sistema",
            value: formatMoney(money(locked.system_hard_cap_usd_cents, "USD")),
          },
          { label: "Cuenta origen", value: locked.source_account_id },
          { label: "Aprobadores", value: locked.approvers.join(", ") },
          { label: "Tasas de cambio", value: `fijas al ${calendarDate(organization.fx.asOf)}` },
        ]}
        extraTabs={[
          { id: "tasas", label: "Tasas de cambio", content: <RatesTable fx={organization.fx} /> },
        ]}
        versions={{
          count: versions.length,
          content: (
            <ol className="divide-y divide-line card text-[13px]">
              {versions.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <span className="w-10 font-medium text-ink">v{v.version}</span>
                  <span className="text-ink-2">{v.signed_by}</span>
                  <span className="text-ink-3">{instant(v.signed_at, config.displayTimeZone)}</span>
                  <span className="font-mono text-[12px] text-ink-3">
                    {v.content_hash.slice(0, 10)}…
                  </span>
                  {v.note ? <span className="text-ink-2">· {v.note}</span> : null}
                </li>
              ))}
            </ol>
          ),
        }}
      />
    </div>
  );
}
