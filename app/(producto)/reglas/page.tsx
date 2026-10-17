import { cookies } from "next/headers";

import { getCurrentPolicy, listEvents, listPolicyVersions } from "@/src/db/repositories";
import { formatMoney, money, policyEditToYaml } from "@/src/domain";
import { APPROVER_COOKIE, verifyApprover } from "@/src/session";
import { instant } from "@/src/ui/format";

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
 * Reglas (docs/interfaz.md §5.4): la política vigente en formulario y YAML, los interruptores
 * de control, las claves protegidas que no se editan y el historial de versiones. "Ver qué
 * cambiaría" muestra el efecto de un cambio antes de guardarlo.
 */
export default async function ReglasPage() {
  const { config, db, organization } = await appContext();
  const [current, versions, events] = await Promise.all([
    getCurrentPolicy(db, organization.id),
    listPolicyVersions(db, organization.id),
    listEvents(db, organization.id, { limit: 100 }),
  ]);
  // La última reevaluación queda en la bitácora: es lo que pasó al guardar, no un aviso efímero.
  const replay = events.find((e) => e.type === "policy.replayed");
  const replayed = replay
    ? {
        who: replay.actor.kind === "humano" ? replay.actor.name : "el agente",
        at: replay.occurred_at,
        version: Number(replay.data["version"]),
        reevaluated: Number(replay.data["evaluated"]) - Number(replay.data["skipped"] ?? 0),
        changed: Number(replay.data["changed"]),
      }
    : null;
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
    <div className="max-w-7xl space-y-6 pb-12">
      <PageHeader
        title="Reglas"
        meta={
          <span>
            Política v{current.version} · firmada por {current.signed_by} ·{" "}
            {instant(current.signed_at)}
          </span>
        }
      />

      {replayed ? (
        <p
          role="status"
          className="rounded-[var(--radius-control)] bg-surface-sunken px-3 py-2 text-[13px] text-ink-2"
        >
          Última reevaluación: v{replayed.version} guardada por {replayed.who} ·{" "}
          {instant(replayed.at)} · {replayed.reevaluated} facturas abiertas reevaluadas,{" "}
          {replayed.changed} cambiaron de veredicto.
        </p>
      ) : null}

      <div className="max-w-sm">
        <ApproverPicker
          approvers={locked.approvers}
          approver={signer}
          path="/reglas"
          label="Firmas como"
        />
      </div>

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
        ]}
      />

      <section aria-labelledby="versiones" className="space-y-2">
        <h2 id="versiones" className="text-[12px] font-semibold tracking-wide text-ink-2 uppercase">
          Versiones
        </h2>
        <ol className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface text-[13px]">
          {versions.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <span className="w-10 font-medium text-ink">v{v.version}</span>
              <span className="text-ink-2">{v.signed_by}</span>
              <span className="text-ink-3">{instant(v.signed_at)}</span>
              <span className="font-mono text-[12px] text-ink-3">
                {v.content_hash.slice(0, 10)}…
              </span>
              {v.note ? <span className="text-ink-2">· {v.note}</span> : null}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
