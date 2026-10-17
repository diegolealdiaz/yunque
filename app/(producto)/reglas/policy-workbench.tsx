"use client";

import Link from "next/link";
import { useActionState, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { parseDocument } from "yaml";

import { CONFIGURABLE_RULES, RULES, type RuleCode } from "@/src/domain/rules";
import { RULE_SHORT_LABEL } from "@/src/ui/labels";

import { ActionOutcome } from "../../_components/action-outcome";
import { PolicyEditor, type PolicyTab, type ProtectedKey } from "../../_components/policy-editor";
import { VerdictChip } from "../../_components/verdict-chip";

import { previewAction, saveAction } from "./actions";

/**
 * Formulario y YAML de la política, sincronizados (docs/interfaz.md §5.4, P-106). Las dos
 * vistas editan el mismo documento YAML: el formulario lee y escribe claves concretas sobre
 * él, y el YAML se edita entero. El navegador no valida la política: el servidor la valida
 * con el esquema estricto al ver qué cambiaría y al guardar.
 *
 * El formulario cabe en una pantalla: límites y parámetros a la izquierda, qué hacer cuando
 * una regla no se cumple a la derecha, y la barra de acciones fija abajo. "Ver qué cambiaría"
 * abre su resultado en un diálogo, desde donde se puede guardar sin buscarlo en la página.
 */

type Path = readonly (string | number)[];

/** Campos del formulario y cómo se ven: montos en dólares (el YAML guarda centavos). */
type FieldBase = {
  readonly path: Path;
  readonly label: string;
  /** Qué controla el campo, en una frase que entienda quien no leyó el código. */
  readonly help: string;
};

type FieldSpec =
  | (FieldBase & { readonly kind: "usd" })
  | (FieldBase & { readonly kind: "int"; readonly unit: string })
  | (FieldBase & { readonly kind: "percent" })
  | (FieldBase & { readonly kind: "ratio" });

const LIMITS: readonly FieldSpec[] = [
  {
    kind: "usd",
    path: ["limits", "per_payment", "amount"],
    label: "Límite por pago",
    help: "Ningún pago puede superar este monto. Si lo supera, se frena.",
  },
  {
    kind: "usd",
    path: ["limits", "approval_threshold", "amount"],
    label: "Umbral de aprobación",
    help: "Hasta este monto el agente paga solo; por encima, lo aprueba una persona.",
  },
  {
    kind: "usd",
    path: ["limits", "budget", "amount"],
    label: "Presupuesto del periodo",
    help: "Lo máximo que se puede pagar en total en el periodo, sumando todas las facturas.",
  },
];

const PARAMETERS: readonly FieldSpec[] = [
  {
    kind: "percent",
    path: ["rules", "amount_mismatch", "tolerance_bp"],
    label: "Tolerancia frente a lo acordado",
    help: "Cuánta diferencia se acepta entre lo que cobra la factura y la tarifa acordada.",
  },
  {
    kind: "int",
    path: ["rules", "duplicate_invoice", "window_days"],
    label: "Ventana de duplicados",
    help: "Cuántos días hacia atrás se busca si la misma factura ya llegó.",
    unit: "días",
  },
  {
    kind: "int",
    path: ["rules", "due_date_window", "schedule_days_before"],
    label: "Programar antes del vencimiento",
    help: "Con cuántos días de anticipación al vencimiento se programa el pago.",
    unit: "días",
  },
  {
    kind: "int",
    path: ["rules", "due_date_window", "max_days_overdue"],
    label: "Atraso máximo",
    help: "Una factura con más días de vencida que esto no se paga sin revisión.",
    unit: "días",
  },
  {
    kind: "ratio",
    path: ["rules", "field_low_confidence", "min_confidence"],
    label: "Confianza mínima de lectura",
    help: "Si el agente lee un dato clave con menos seguridad que esto (0 a 1), lo revisa una persona.",
  },
];

/**
 * Cada regla configurable dicha como lo que la dispara, con los valores vigentes de la
 * política dentro de la frase. El título del dominio sigue en el YAML y en el código.
 */
const RULE_COPY: Readonly<
  Partial<
    Record<
      RuleCode,
      { readonly label: string; readonly help: (get: (p: Path) => unknown) => string }
    >
  >
> = {
  payee_not_allowed: {
    label: "Beneficiario fuera de la lista",
    help: () => "Se quiere pagar a alguien que no está en la lista de beneficiarios aprobados.",
  },
  vendor_velocity: {
    label: "Muchas facturas seguidas del mismo beneficiario",
    help: (get) =>
      `${num(get(["rules", "vendor_velocity", "max_invoices"]))} o más facturas de un mismo beneficiario en ${num(get(["rules", "vendor_velocity", "window_days"]))} días. Puede ser un cobro repetido o un fraude.`,
  },
  budget_exceeded: {
    label: "Se pasa del presupuesto",
    help: () => "El pago no cabe en lo que queda del presupuesto del periodo.",
  },
  duplicate_invoice: {
    label: "Factura duplicada",
    help: (get) =>
      `El mismo archivo o la misma factura ya llegó en los últimos ${num(get(["rules", "duplicate_invoice", "window_days"]))} días.`,
  },
  amount_mismatch: {
    label: "Cobra distinto a lo acordado",
    help: (get) =>
      `El monto se aleja más de ${percent(get(["rules", "amount_mismatch", "tolerance_bp"]))} de la tarifa o el contrato registrado del beneficiario.`,
  },
  first_payment_to_vendor: {
    label: "Primer pago a un beneficiario",
    help: () => "Nunca se le ha pagado antes: conviene que una persona confirme sus datos.",
  },
  amount_unusual_for_vendor: {
    label: "Monto fuera de lo habitual",
    help: (get) =>
      `Se aleja más de ${percent(get(["rules", "amount_unusual_for_vendor", "deviation_bp"]))} del promedio pagado a ese beneficiario (con al menos ${num(get(["rules", "amount_unusual_for_vendor", "min_history"]))} pagos previos).`,
  },
  due_date_window: {
    label: "Factura muy vencida",
    help: (get) =>
      `Lleva más de ${num(get(["rules", "due_date_window", "max_days_overdue"]))} días vencida.`,
  },
};

/** Número de la política para una frase; si el YAML no lo trae, un guion. */
function num(raw: unknown): string {
  return typeof raw === "number" ? String(raw) : "—";
}

/** Puntos básicos como porcentaje: 500 → «5 %». */
function percent(raw: unknown): string {
  return typeof raw === "number" ? `${String(raw / 100)} %` : "—";
}

function read(yaml: string): { readonly ok: boolean; readonly get: (path: Path) => unknown } {
  const doc = parseDocument(yaml);
  return { ok: doc.errors.length === 0, get: (path) => doc.getIn(path) };
}

function write(yaml: string, path: Path, value: unknown): string {
  const doc = parseDocument(yaml);
  doc.setIn(path, value);
  return doc.toString({ lineWidth: 0 });
}

/** Valor del YAML como se muestra en el formulario. */
function display(spec: FieldSpec, raw: unknown): string {
  if (typeof raw !== "number") return "";
  switch (spec.kind) {
    case "usd":
      return (raw / 100).toFixed(2);
    case "percent":
      return (raw / 100).toString();
    default:
      return String(raw);
  }
}

/** Lo que la persona escribe, convertido al valor que guarda el YAML. */
function stored(spec: FieldSpec, text: string): number | null {
  const n = Number(text.replace(",", "."));
  if (!Number.isFinite(n) || text.trim() === "") return null;
  switch (spec.kind) {
    case "usd":
      return Math.round(n * 100);
    case "percent":
      return Math.round(n * 100);
    case "int":
      return Math.round(n);
    case "ratio":
      return n;
  }
}

function NumberField({
  spec,
  yaml,
  onChange,
  disabled,
}: {
  readonly spec: FieldSpec;
  readonly yaml: string;
  readonly onChange: (next: string) => void;
  readonly disabled: boolean;
}) {
  const value = display(spec, read(yaml).get(spec.path));
  const helpId = useId();
  const unit =
    spec.kind === "usd"
      ? "USD"
      : spec.kind === "percent"
        ? "%"
        : spec.kind === "int"
          ? spec.unit
          : "0 a 1";
  return (
    <label className="flex items-center justify-between gap-4 py-2 text-[13px]">
      <span className="min-w-0">
        <span className="block text-ink">{spec.label}</span>
        <span id={helpId} className="block text-[12px] leading-snug text-ink-3">
          {spec.help}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        <input
          key={value}
          aria-describedby={helpId}
          defaultValue={value}
          inputMode="decimal"
          disabled={disabled}
          onBlur={(e) => {
            const next = stored(spec, e.target.value);
            if (next !== null) onChange(write(yaml, spec.path, next));
          }}
          className="num h-8 w-28 rounded-[var(--radius-control)] border border-control bg-surface px-2 text-right text-ink disabled:opacity-60"
        />
        <span className="w-10 text-[12px] text-ink-3">{unit}</span>
      </span>
    </label>
  );
}

/** Tarjeta de un grupo del formulario: título, una frase de qué controla y sus campos. */
function Group({
  title,
  hint,
  children,
}: {
  readonly title: string;
  readonly hint: string;
  readonly children: ReactNode;
}) {
  return (
    <fieldset className="rounded-[var(--radius-card)] border border-line bg-surface px-4 pt-3 pb-2">
      <legend className="sr-only">{title}</legend>
      <p aria-hidden="true" className="text-[13px] font-semibold text-ink">
        {title}
      </p>
      <p className="mb-1 text-[12px] text-ink-3">{hint}</p>
      <div className="divide-y divide-line">{children}</div>
    </fieldset>
  );
}

/** Qué hace el agente cuando la regla no se cumple: dos opciones a la vista, no un menú. */
function RuleChoice({
  code,
  value,
  help,
  onChange,
  disabled,
}: {
  readonly code: RuleCode;
  readonly value: string;
  /** Qué dispara la regla, con los valores vigentes. */
  readonly help: string;
  readonly onChange: (next: "escalar" | "frenar") => void;
  readonly disabled: boolean;
}) {
  const options = [
    { value: "escalar", label: "Escalar", on: "bg-escalate-tint text-escalate" },
    { value: "frenar", label: "Frenar", on: "bg-hold-tint text-hold" },
  ] as const;
  const helpId = useId();
  const label = RULE_COPY[code]?.label ?? RULES[code].title;
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-describedby={helpId}
      className="flex items-center justify-between gap-4 py-2 text-[13px]"
    >
      <span className="min-w-0" title={code}>
        <span className="block text-ink">{label}</span>
        <span id={helpId} className="block text-[12px] leading-snug text-ink-3">
          {help}
        </span>
      </span>
      <span className="inline-flex shrink-0 rounded-[var(--radius-control)] border border-control p-0.5">
        {options.map((option) => (
          <label
            key={option.value}
            className={`cursor-pointer rounded-[3px] px-2.5 py-0.5 text-[12px] font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ink ${
              value === option.value ? option.on : "text-ink-2 hover:text-ink"
            } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
          >
            <input
              type="radio"
              name={`regla-${code}`}
              value={option.value}
              checked={value === option.value}
              disabled={disabled}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </span>
    </div>
  );
}

export function PolicyWorkbench({
  initialYaml,
  version,
  signedBy,
  protectedKeys,
  canSign,
  versions,
  extraTabs = [],
}: {
  readonly initialYaml: string;
  readonly version: number;
  readonly signedBy: string;
  readonly protectedKeys: readonly ProtectedKey[];
  /** Hay un aprobador elegido para firmar. */
  readonly canSign: boolean;
  /** Historial de versiones, ya armado por la pantalla. */
  readonly versions: { readonly count: number; readonly content: ReactNode };
  /** Pestañas de solo lectura después de las versiones. */
  readonly extraTabs?: readonly PolicyTab[];
}) {
  const [yaml, setYaml] = useState(initialYaml);
  const [preview, runPreview, previewing] = useActionState(previewAction, null);
  // El YAML con el que se calculó la vista previa: si se edita después, queda desactualizada.
  const [previewedYaml, setPreviewedYaml] = useState<string | null>(null);
  const previewDialog = useRef<HTMLDialogElement>(null);
  const stale = preview !== null && previewedYaml !== yaml;
  // El resultado se abre en un diálogo: se ve sin buscarlo y el lector de pantalla lo anuncia.
  useEffect(() => {
    if (preview) previewDialog.current?.showModal();
  }, [preview]);
  const [saved, runSave, saving] = useActionState(saveAction, null);
  const dialog = useRef<HTMLDialogElement>(null);
  const parsed = useMemo(() => read(yaml), [yaml]);
  const dirty = yaml !== initialYaml;
  const openSave = () => {
    previewDialog.current?.close();
    dialog.current?.showModal();
  };

  const form = (
    <div className="space-y-3">
      {!parsed.ok ? (
        <p
          role="alert"
          className="rounded-[var(--radius-control)] bg-hold-tint px-3 py-2 text-[13px] text-hold"
        >
          El YAML tiene errores de sintaxis: corrígelo en «Como código» para volver a usar el
          formulario.
        </p>
      ) : null}
      <div className="grid items-start gap-3 lg:grid-cols-2">
        <div className="space-y-3">
          <Group
            title="Límites"
            hint="Cuánto puede pagar el agente sin pedir permiso, en USD. Otras monedas se convierten con las tasas de la empresa."
          >
            {LIMITS.map((spec) => (
              <NumberField
                key={spec.path.join(".")}
                spec={spec}
                yaml={yaml}
                onChange={setYaml}
                disabled={!parsed.ok}
              />
            ))}
            <label className="flex items-center justify-between gap-4 py-2 text-[13px]">
              <span className="min-w-0">
                <span className="block text-ink">Periodo del presupuesto</span>
                <span className="block text-[12px] leading-snug text-ink-3">
                  Cada cuánto se reinicia el presupuesto.
                </span>
              </span>
              <select
                value={String(parsed.get(["limits", "budget", "period"]) ?? "month")}
                disabled={!parsed.ok}
                onChange={(e) =>
                  setYaml(write(yaml, ["limits", "budget", "period"], e.target.value))
                }
                className="mr-[2.875rem] h-8 w-28 rounded-[var(--radius-control)] border border-control bg-surface px-2 text-ink"
              >
                <option value="month">mes</option>
                <option value="week">semana</option>
              </select>
            </label>
          </Group>
          <Group title="Parámetros" hint="Tolerancias y plazos que usan las reglas.">
            {PARAMETERS.map((spec) => (
              <NumberField
                key={spec.path.join(".")}
                spec={spec}
                yaml={yaml}
                onChange={setYaml}
                disabled={!parsed.ok}
              />
            ))}
          </Group>
        </div>
        <Group
          title="Si una regla no se cumple"
          hint="Qué hace el agente con la factura: Escalar la deja para que la decida una persona; Frenar la detiene y no se paga."
        >
          {CONFIGURABLE_RULES.map((code: RuleCode) => (
            <RuleChoice
              key={code}
              code={code}
              value={String(parsed.get(["rules", code, "on_fail"]) ?? "")}
              help={RULE_COPY[code]?.help(parsed.get) ?? ""}
              disabled={!parsed.ok}
              onChange={(next) => setYaml(write(yaml, ["rules", code, "on_fail"], next))}
            />
          ))}
        </Group>
      </div>
    </div>
  );

  const editor = (
    <label className="flex flex-col gap-2">
      <span className="sr-only">Política en YAML</span>
      <span className="text-[12px] text-ink-3">
        La misma política como código, para auditarla o copiarla. Los montos van en centavos de
        dólar y las tolerancias en puntos básicos (500 = 5 %).
      </span>
      <textarea
        value={yaml}
        onChange={(e) => setYaml(e.target.value)}
        spellCheck={false}
        rows={22}
        className="w-full rounded-[var(--radius-card)] border border-line bg-surface-sunken p-4 font-mono text-[12px] leading-relaxed text-ink"
      />
    </label>
  );

  const actions = (
    <>
      <p className="mr-auto text-[12px] text-ink-2">
        {!canSign
          ? "Elige arriba quién firma para poder guardar."
          : dirty
            ? "Cambios sin guardar."
            : "Sin cambios."}
      </p>
      {dirty ? (
        <button
          type="button"
          onClick={() => setYaml(initialYaml)}
          className="h-8 px-2 text-[13px] text-ink-2 underline underline-offset-4"
        >
          Descartar
        </button>
      ) : null}
      <form action={runPreview} onSubmit={() => setPreviewedYaml(yaml)}>
        <input type="hidden" name="yaml" value={yaml} />
        <button
          type="submit"
          disabled={previewing}
          className="h-8 rounded-[var(--radius-control)] border border-control px-3 text-[13px] font-medium text-ink"
        >
          {previewing ? "Calculando…" : "Ver qué cambiaría"}
        </button>
      </form>
      <button
        type="button"
        disabled={!dirty || !canSign || saving}
        onClick={openSave}
        className="h-8 rounded-[var(--radius-control)] bg-ink px-3 text-[13px] font-medium text-surface disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-3"
      >
        Guardar como v{version + 1}
      </button>
    </>
  );

  return (
    <div className="space-y-3">
      <ActionOutcome state={saved} />

      <PolicyEditor
        version={version}
        signedBy={signedBy}
        form={form}
        yaml={editor}
        protectedKeys={protectedKeys}
        actions={actions}
        versions={versions}
        extraTabs={extraTabs}
      />

      <dialog
        ref={previewDialog}
        aria-labelledby="vista-previa-titulo"
        className="m-auto w-full max-w-xl rounded-[var(--radius-card)] border border-line bg-surface p-5 text-ink backdrop:bg-ink/30"
      >
        {preview?.ok === false ? (
          <div className="space-y-2 text-[13px]">
            <p id="vista-previa-titulo" className="text-[14px] font-medium text-hold">
              La política no es válida
            </p>
            <ul className="list-disc space-y-1 pl-5 text-ink-2">
              {preview.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {preview?.ok ? (
          <div className="space-y-3 text-[13px]">
            <p id="vista-previa-titulo" className="text-[14px] font-medium">
              {preview.changes.length === 0
                ? `Ninguna de las ${String(preview.evaluated - preview.skipped)} facturas abiertas cambiaría de veredicto.`
                : `${String(preview.changes.length)} de ${String(preview.evaluated - preview.skipped)} facturas abiertas cambiarían de veredicto`}
            </p>
            {stale ? (
              <p className="text-[12px] font-medium text-ink">
                Editaste la política después de calcular: vuelve a ver qué cambiaría.
              </p>
            ) : null}
            {preview.changes.length > 0 ? (
              <ul
                className={`max-h-[50vh] divide-y divide-line overflow-y-auto ${stale ? "opacity-60" : ""}`}
              >
                {preview.changes.map((change) => (
                  <li key={change.invoiceId} className="flex flex-wrap items-center gap-2 py-2">
                    <Link
                      href={`/facturas/${change.invoiceId}`}
                      className="w-36 font-mono text-[12px] text-ink underline underline-offset-4"
                    >
                      {change.reference}
                    </Link>
                    <VerdictChip verdict={change.before.verdict} />
                    {change.before.rule ? (
                      <span className="text-ink-3">{RULE_SHORT_LABEL[change.before.rule]}</span>
                    ) : null}
                    <span aria-hidden="true" className="text-ink-3">
                      →
                    </span>
                    <span className="sr-only">pasaría a</span>
                    <VerdictChip verdict={change.after.verdict} />
                    {change.after.rule ? (
                      <span className="text-ink-3">{RULE_SHORT_LABEL[change.after.rule]}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {preview.skipped > 0 ? (
              <p className="text-[12px] text-ink-3">
                {preview.skipped} sin lectura guardada no se pueden reevaluar.
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => previewDialog.current?.close()}
            className="h-8 rounded-[var(--radius-control)] border border-control px-3 text-[13px]"
          >
            Cerrar
          </button>
          {preview?.ok && !stale ? (
            <button
              type="button"
              disabled={!dirty || !canSign || saving}
              onClick={openSave}
              className="h-8 rounded-[var(--radius-control)] bg-ink px-3 text-[13px] font-medium text-surface disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-3"
            >
              Guardar como v{version + 1}
            </button>
          ) : null}
        </div>
      </dialog>

      <dialog
        ref={dialog}
        aria-labelledby="guardar-titulo"
        className="m-auto max-w-sm rounded-[var(--radius-card)] border border-line bg-surface p-5 text-ink backdrop:bg-ink/30"
      >
        <form
          action={(data) => {
            dialog.current?.close();
            runSave(data);
          }}
          className="space-y-3"
        >
          <p id="guardar-titulo" className="text-[14px] font-medium">
            ¿Guardar la política como v{version + 1}?
          </p>
          <p className="text-[13px] text-ink-2">
            Queda firmada con tu nombre y se reevalúan las facturas abiertas con ella. Las pagadas
            no se tocan.
          </p>
          <input type="hidden" name="yaml" value={yaml} />
          <input type="hidden" name="version" value={version} />
          <label className="block text-[13px]">
            <span className="text-[12px] text-ink-3">Nota (opcional, queda en la versión)</span>
            <input
              name="nota"
              maxLength={500}
              className="mt-1 h-8 w-full rounded-[var(--radius-control)] border border-control px-2"
            />
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => dialog.current?.close()}
              className="h-8 rounded-[var(--radius-control)] border border-control px-3 text-[13px]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="h-8 rounded-[var(--radius-control)] bg-ink px-3 text-[13px] font-medium text-surface"
            >
              Guardar y reevaluar
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
