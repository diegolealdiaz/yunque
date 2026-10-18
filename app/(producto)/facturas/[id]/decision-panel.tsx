import type { ReactNode } from "react";

import type { Decision, PaymentOrderDraft } from "@/src/domain";
import { formatMoney } from "@/src/domain";
import { calendarDate, instant } from "@/src/ui/format";
import { RAIL_LABEL } from "@/src/ui/labels";
import type { InvoiceDetail } from "@/src/usecases";

import { ReevaluateButton } from "./correction-form";
import { ResolutionPanel } from "./resolution-panel";

/**
 * La columna "Tu decisión": qué puede hacer la persona, o cómo terminó la factura. Un caso
 * por estado: esperando aprobación, rechazada, pagada, escalada ya resuelta o frenada.
 */

export type Resolution = Parameters<typeof ResolutionPanel>[0];

type Approval = NonNullable<InvoiceDetail["approval"]>;

export function DecisionPanel({
  detail,
  resolution,
  approver,
  timeZone,
}: {
  readonly detail: InvoiceDetail;
  readonly resolution: Resolution | null;
  /** Aprobador elegido (cookie verificada), o null. */
  readonly approver: string | null;
  readonly timeZone: string;
}) {
  const { decision, invoice, approval } = detail;
  if (!decision) {
    return <p className="text-[13px] text-ink-2">La factura todavía no tiene decisión.</p>;
  }
  if (invoice.status === "esperando_aprobacion" && resolution) {
    return <ResolutionPanel {...resolution} />;
  }
  if (invoice.status === "rechazada" && approval) {
    return <Rejected approval={approval} timeZone={timeZone} />;
  }
  if (decision.verdict === "pagar") return <Paid decision={decision} timeZone={timeZone} />;
  // Escalada que ya no espera: el historial sembrado trae aprobadas sin orden de Yunque. No
  // es una frenada, y la pantalla no debe decir que lo es.
  if (decision.verdict === "escalar") {
    return (
      <Escalated approved={invoice.status === "aprobada"} approval={approval} timeZone={timeZone} />
    );
  }
  return (
    <Held
      invoiceId={invoice.id}
      newerPolicy={detail.newerPolicy}
      canReevaluate={approver !== null}
    />
  );
}

function Panel({ children }: { readonly children: ReactNode }) {
  return <div className="space-y-2 text-[13px]">{children}</div>;
}

function Rejected({
  approval,
  timeZone,
}: {
  readonly approval: Approval;
  readonly timeZone: string;
}) {
  return (
    <Panel>
      <p className="font-medium text-hold">
        Rechazada por {approval.approver} · {instant(approval.created_at, timeZone)}
      </p>
      <p className="text-ink-2">Motivo: {approval.reason}</p>
      <p className="text-ink-3">El rechazo es final: la factura no se pagará.</p>
    </Panel>
  );
}

function Paid({ decision, timeZone }: { readonly decision: Decision; readonly timeZone: string }) {
  const order = decision.payment_order;
  return (
    <Panel>
      <p className="font-medium text-pay">
        {decision.actor.kind === "humano"
          ? `Aprobada por ${decision.actor.name} · ${instant(decision.decided_at, timeZone)}`
          : "Pagada por el agente dentro de las reglas."}
      </p>
      {order ? (
        <PaymentOrder order={order} invoiceId={decision.invoice_id} />
      ) : (
        <p className="text-ink-2">
          Modo de prueba: decidida sin preparar orden ni comprometer presupuesto.
        </p>
      )}
    </Panel>
  );
}

function PaymentOrder({
  order,
  invoiceId,
}: {
  readonly order: PaymentOrderDraft;
  readonly invoiceId: string;
}) {
  return (
    <>
      <dl className="space-y-1">
        <OrderRow label="Orden">
          <span className="font-medium">preparada, no ejecutada</span>
        </OrderRow>
        <OrderRow label="A">{order.beneficiary_name}</OrderRow>
        <OrderRow label="Cuenta" mono>
          {order.account_masked} · {RAIL_LABEL[order.rail]}
        </OrderRow>
        <OrderRow label="Monto" mono>
          {formatMoney(order.amount)}
        </OrderRow>
        <OrderRow label="Programada">{calendarDate(order.scheduled_for)}</OrderRow>
      </dl>
      {/* Descarga de archivo, no navegación: un enlace simple con `download`. */}
      <a
        href={`/facturas/${invoiceId}/orden`}
        download
        className="inline-flex h-8 items-center rounded-[var(--radius-control)] border border-control px-3 text-[13px] font-medium text-ink"
      >
        Descargar orden en PDF
      </a>
    </>
  );
}

function OrderRow({
  label,
  mono = false,
  children,
}: {
  readonly label: string;
  readonly mono?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-ink-3">{label}</dt>
      <dd className={mono ? "font-mono" : undefined}>{children}</dd>
    </div>
  );
}

function Escalated({
  approved,
  approval,
  timeZone,
}: {
  readonly approved: boolean;
  readonly approval: Approval | null;
  readonly timeZone: string;
}) {
  return (
    <Panel>
      {approved ? (
        <p className="font-medium text-pay">
          Aprobada por {approval ? approval.approver : "una persona"}
          {approval ? ` · ${instant(approval.created_at, timeZone)}` : ""}
        </p>
      ) : (
        <p className="font-medium text-escalate">Escalada a una persona.</p>
      )}
      <p className="text-ink-2">
        {approved
          ? "El agente la escaló y una persona la aprobó."
          : "El agente la escaló: la decide una persona."}
      </p>
    </Panel>
  );
}

function Held({
  invoiceId,
  newerPolicy,
  canReevaluate,
}: {
  readonly invoiceId: string;
  readonly newerPolicy: boolean;
  /** Hay un aprobador elegido: solo así se puede reevaluar. */
  readonly canReevaluate: boolean;
}) {
  return (
    <Panel>
      <p className="font-medium text-hold">El agente la frenó.</p>
      <p className="text-ink-2">No se paga. Arriba está el porqué.</p>
      {newerPolicy ? (
        <>
          <p className="text-ink-2">
            Hay una versión de política más nueva: se puede reevaluar con ella.
          </p>
          <ReevaluateButton
            invoiceId={invoiceId}
            disabledReason={canReevaluate ? null : "Elige quién resuelve para poder reevaluar."}
          />
        </>
      ) : null}
    </Panel>
  );
}
