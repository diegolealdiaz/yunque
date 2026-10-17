import type { ReactNode } from "react";

import { formatMoney, money } from "@/src/domain";
import { dueRelative } from "@/src/ui/format";

import { ApprovalChecklist } from "../../_components/approval-checklist";
import { ConfidenceDot } from "../../_components/confidence-dot";
import { ControlSwitch } from "../../_components/control-switch";
import { DataTable } from "../../_components/data-table";
import {
  DocumentViewer,
  EvidenceProvider,
  EvidenceTarget,
  type Highlight,
} from "../../_components/document-viewer";
import { PageHeader } from "../../_components/page-header";
import { PolicyEditor } from "../../_components/policy-editor";
import { StatCard } from "../../_components/stat-card";
import { EmptyState, ErrorState, TableSkeleton } from "../../_components/states";
import { Timeline } from "../../_components/timeline";
import { VerdictChip } from "../../_components/verdict-chip";

export const metadata = { title: "Componentes · Yunque" };

/**
 * Página de componentes (paso 19, P-100): los nueve componentes base y los estados, con
 * datos de muestra del dataset. Sirve para revisar contraste, foco y escape de un vistazo.
 * Todo lo de aquí es ficticio.
 */

const TODAY = "2026-10-17";

/** Beneficiario hostil: debe verse como texto literal en todas partes (P-110). */
const HOSTILE_NAME = "<img src=x onerror=alert(1)>";

const PAGE_TEXT = [
  "FACTURA ELECTRÓNICA DE VENTA",
  "Nube Andina SAS",
  "NIT 901234567-8",
  "No. F-2291",
  "Fecha: 10/10/2026",
  "Vence: 25/10/2026",
  "Hosting y soporte, octubre 2026",
  "Subtotal: 4.033.613,45",
  "IVA 19 %: 766.386,55",
  "TOTAL: 4.800.000,00",
  "Moneda: COP",
  "Titular: Nube Andina SAS",
  "Cuenta: 31245679023",
].join("\n");

const FIELDS: readonly (Highlight & { readonly value: string; readonly confidence: number })[] = [
  {
    id: "payee_name",
    label: "Beneficiario",
    value: "Nube Andina SAS",
    quote: "Nube Andina SAS",
    confidence: 0.98,
    page: 1,
    box: { x: 0.0952, y: 0.1077, w: 0.35, h: 0.0269 },
  },
  {
    id: "invoice_number",
    label: "Número",
    value: "F-2291",
    quote: "F-2291",
    confidence: 0.95,
    page: 1,
    box: { x: 0.619, y: 0.1077, w: 0.2857, h: 0.0236 },
  },
  {
    id: "due_date",
    label: "Vence",
    value: "25 oct 2026",
    quote: "25/10/2026",
    confidence: 0.91,
    page: 1,
    box: { x: 0.619, y: 0.1616, w: 0.2857, h: 0.0202 },
  },
  {
    id: "total",
    label: "Monto",
    value: formatMoney(money(480_000_000, "COP")),
    quote: "4.800.000,00",
    confidence: 0.99,
    page: 1,
    box: { x: 0.5238, y: 0.5253, w: 0.381, h: 0.0269 },
  },
  {
    id: "bank_account",
    label: "Cuenta",
    value: "****9023",
    quote: "31245679023",
    confidence: 0.78,
    page: 1,
    box: { x: 0.0952, y: 0.6431, w: 0.4, h: 0.0202 },
  },
];

const YAML = `limits:
  per_payment: { amount: 2000000, currency: USD }
  approval_threshold: { amount: 500000, currency: USD }
  budget: { amount: 10000000, currency: USD, period: month }
rules:
  duplicate_invoice: { on_fail: frenar, window_days: 90 }
  first_payment_to_vendor: { on_fail: escalar }
  amount_mismatch: { on_fail: escalar, tolerance_bp: 500 }`;

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-[12px] font-medium tracking-wide text-ink-2 uppercase">{title}</h2>
      {children}
    </section>
  );
}

export default function ComponentsPage() {
  const rows = [
    {
      key: "1",
      href: "/componentes#detalle",
      due: "2026-10-19",
      payee: "Nube Andina SAS",
      amount: formatMoney(money(480_000_000, "COP")),
      verdict: "escalar" as const,
      rule: {
        code: "bank_account_mismatch" as const,
        observed: "****4471",
        threshold: "****9023",
      },
    },
    {
      key: "2",
      href: "/componentes#detalle",
      due: "2026-10-22",
      payee: HOSTILE_NAME,
      amount: formatMoney(money(125_000, "USD")),
      verdict: "escalar" as const,
      rule: {
        code: "payee_not_allowed" as const,
        observed: HOSTILE_NAME,
        threshold: "lista de beneficiarios",
      },
    },
    {
      key: "3",
      href: "/componentes#detalle",
      due: "2026-10-12",
      payee: "Datenwerk GmbH",
      amount: formatMoney(money(420_000, "EUR")),
      verdict: "frenar" as const,
      rule: {
        code: "duplicate_invoice" as const,
        observed: "la misma factura que YQ-2026-10-0001",
        threshold: "una sola vez en 90 días",
      },
    },
    {
      key: "4",
      href: "/componentes#detalle",
      due: "2026-10-30",
      payee: "Camila Rojas",
      amount: formatMoney(money(760_000_000, "COP")),
      verdict: "pagar" as const,
      rule: null,
    },
  ];

  return (
    <div className="max-w-6xl space-y-10 pb-16">
      <PageHeader
        title="Componentes"
        meta={<span>Paso 19 · datos de muestra, todo ficticio</span>}
      />

      <Section title="1. Chip de veredicto con su regla">
        <div className="flex flex-wrap gap-3">
          <VerdictChip verdict="pagar" />
          <VerdictChip verdict="escalar" rule={rows[0]?.rule ?? null} policyVersion={4} />
          <VerdictChip verdict="frenar" rule={rows[2]?.rule ?? null} policyVersion={4} />
          <VerdictChip verdict="en_proceso" />
        </div>
      </Section>

      <Section title="2. Tabla con teclado (J, K, Enter)">
        <input
          data-shortcut="buscar"
          type="search"
          placeholder="Buscar beneficiario o referencia ( / )"
          className="h-8 w-72 rounded-[var(--radius-control)] border border-control bg-surface px-2.5 text-[13px] text-ink placeholder:text-ink-3"
        />
        <DataTable
          caption="Facturas de muestra"
          columns={[
            { header: "Beneficiario" },
            { header: "Monto", align: "right", width: "11rem" },
            { header: "Vence", width: "10rem" },
            { header: "Veredicto", width: "18rem" },
          ]}
          rows={rows.map((r) => ({
            key: r.key,
            href: r.href,
            cells: [
              <span key="p" className="font-medium">
                {r.payee}
              </span>,
              <span key="a" className="font-mono">
                {r.amount}
              </span>,
              <span key="d" className="text-ink-2">
                {dueRelative(r.due, TODAY)}
              </span>,
              <VerdictChip key="v" verdict={r.verdict} rule={r.rule} policyVersion={4} />,
            ],
          }))}
        />
      </Section>

      <Section title="3. Tarjetas numéricas">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Falsos pagar"
            value="0"
            detail="en 33 facturas del set"
            emphasis
            href="/componentes"
          />
          <StatCard
            label="Autonomía"
            value="93,9 %"
            detail="31 de 33 sin persona"
            href="/componentes"
          />
          <StatCard
            label="Costo por factura"
            value="0,0021 USD"
            detail="lectura con el modelo principal"
          />
        </div>
      </Section>

      <Section title="4 y 5. Visor de documento con citas y punto de confianza">
        <EvidenceProvider>
          <div id="detalle" className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <DocumentViewer
              pages={[{ src: "/muestra/factura-muestra.png", width: 910, height: 1287 }]}
              text={PAGE_TEXT}
              highlights={FIELDS}
            />
            <div className="space-y-1">
              <h3 className="mb-2 text-[12px] font-medium tracking-wide text-ink-2 uppercase">
                Campos leídos
              </h3>
              {FIELDS.map((field) => (
                <EvidenceTarget key={field.id} id={field.id}>
                  <span className="grid grid-cols-[6rem_1fr_auto] items-center gap-2 text-[13px]">
                    <span className="text-ink-2">{field.label}</span>
                    <span className="truncate font-mono text-ink">{field.value}</span>
                    <ConfidenceDot confidence={field.confidence} minimum={0.85} />
                  </span>
                </EvidenceTarget>
              ))}
            </div>
          </div>
        </EvidenceProvider>
      </Section>

      <div className="grid gap-10 lg:grid-cols-2">
        <Section title="6. Checklist de aprobación">
          <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
            <ApprovalChecklist
              items={[
                {
                  code: "bank_account_mismatch",
                  text: "Confirmé el cambio de cuenta con el proveedor por un canal distinto al documento",
                  checked: false,
                },
                {
                  code: "general",
                  text: "Revisé el documento y confirmo beneficiario, monto, moneda y cuenta de destino",
                  checked: false,
                },
              ]}
              signature="doc 3f9a1c…, política v4, 4.800.000 COP a ****4471"
            />
          </div>
        </Section>

        <Section title="7. Línea de tiempo">
          <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
            <Timeline
              timeZone="America/Bogota"
              entries={[
                {
                  id: "1",
                  at: "2026-10-17T14:12:03.000Z",
                  label: "Recibida",
                  detail: "bandeja de correo",
                  actor: "agente",
                },
                {
                  id: "2",
                  at: "2026-10-17T14:12:05.000Z",
                  label: "Leída",
                  detail: "1,8 s · 0,0021 USD",
                  actor: "agente",
                },
                {
                  id: "3",
                  at: "2026-10-17T14:12:05.000Z",
                  label: "Escalada",
                  detail: "bank_account_mismatch",
                  actor: "agente",
                },
                {
                  id: "4",
                  at: "2026-10-17T14:13:40.000Z",
                  label: "Notificada",
                  detail: "pantalla",
                  actor: "agente",
                },
              ]}
            />
          </div>
        </Section>
      </div>

      <Section title="8. Editor doble de política">
        <PolicyEditor
          version={4}
          signedBy="Ana Torres"
          yaml={YAML}
          protectedKeys={[
            { label: "Tope del sistema", value: "100.000,00 USD" },
            { label: "Cuenta origen", value: "acct_forja_usd" },
          ]}
          form={
            <div className="space-y-2 text-[13px]">
              <label className="flex items-center justify-between gap-3">
                <span className="text-ink-2">Límite por pago</span>
                <input
                  defaultValue="20.000,00"
                  className="num h-8 w-36 rounded-[var(--radius-control)] border border-control px-2 text-right"
                />
              </label>
              <label className="flex items-center justify-between gap-3">
                <span className="text-ink-2">Umbral de aprobación</span>
                <input
                  defaultValue="5.000,00"
                  className="num h-8 w-36 rounded-[var(--radius-control)] border border-control px-2 text-right"
                />
              </label>
            </div>
          }
        />
      </Section>

      <Section title="9. Interruptores de control con confirmación">
        <div className="grid gap-3 lg:grid-cols-3">
          <ControlSwitch
            label="Pagos habilitados"
            description="Interruptor de emergencia de todos los pagos"
            checked
            confirmOn="El agente vuelve a pagar lo que cumple las reglas."
            confirmOff="Ninguna factura se pagará: lo que pagaría queda escalado para una persona."
          />
          <ControlSwitch
            label="Modo de prueba"
            description="Decide y registra sin preparar órdenes"
            checked={false}
            confirmOn="Las decisiones se registran pero no comprometen presupuesto ni saldo."
            confirmOff="Las decisiones de pago vuelven a preparar órdenes y comprometer presupuesto."
          />
          <ControlSwitch
            label="Autonomía"
            description="Recomendar o decidir dentro de las reglas"
            checked
            onLabel="Decidir"
            offLabel="Recomendar"
            confirmOn="El agente paga y frena solo dentro de las reglas y escala lo demás."
            confirmOff="Toda decisión pasa por una persona; el agente solo recomienda."
          />
        </div>
      </Section>

      <Section title="Estados: vacío, carga y error">
        <div className="grid gap-4 lg:grid-cols-3">
          <EmptyState
            title="Nada pendiente. El agente resolvió 14 facturas hoy."
            action={{ label: "Ver las 14", href: "/componentes" }}
          />
          <TableSkeleton rows={3} columns={3} />
          <ErrorState
            title="No se pudo leer el documento"
            cause="Está borroso o protegido."
            action="Súbelo de nuevo o escálalo a mano."
          />
        </div>
      </Section>
    </div>
  );
}
