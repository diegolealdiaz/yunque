"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { parseDocument } from "yaml";

import { CONFIGURABLE_RULES, RULES, type RuleCode } from "@/src/domain/rules";
import { RULE_SHORT_LABEL } from "@/src/ui/labels";

import { ActionOutcome } from "../../_components/action-outcome";
import { PolicyEditor, type ProtectedKey } from "../../_components/policy-editor";
import { VerdictChip } from "../../_components/verdict-chip";

import { previewAction, saveAction } from "./actions";

/**
 * Formulario y YAML de la política, sincronizados (docs/interfaz.md §5.4, P-106). Las dos
 * vistas editan el mismo documento YAML: el formulario lee y escribe claves concretas sobre
 * él, y el YAML se edita entero. El navegador no valida la política: el servidor la valida
 * con el esquema estricto al ver qué cambiaría y al guardar.
 */

type Path = readonly (string | number)[];

/** Campos del formulario y cómo se ven: montos en dólares (el YAML guarda centavos). */
type FieldSpec =
  | { readonly kind: "usd"; readonly path: Path; readonly label: string }
  | { readonly kind: "int"; readonly path: Path; readonly label: string; readonly unit: string }
  | { readonly kind: "percent"; readonly path: Path; readonly label: string }
  | { readonly kind: "ratio"; readonly path: Path; readonly label: string };

const LIMITS: readonly FieldSpec[] = [
  { kind: "usd", path: ["limits", "per_payment", "amount"], label: "Límite por pago" },
  { kind: "usd", path: ["limits", "approval_threshold", "amount"], label: "Umbral de aprobación" },
  { kind: "usd", path: ["limits", "budget", "amount"], label: "Presupuesto del periodo" },
];

const PARAMETERS: readonly FieldSpec[] = [
  {
    kind: "percent",
    path: ["rules", "amount_mismatch", "tolerance_bp"],
    label: "Tolerancia frente a lo acordado",
  },
  {
    kind: "int",
    path: ["rules", "duplicate_invoice", "window_days"],
    label: "Ventana de duplicados",
    unit: "días",
  },
  {
    kind: "int",
    path: ["rules", "due_date_window", "schedule_days_before"],
    label: "Programar antes del vencimiento",
    unit: "días",
  },
  {
    kind: "int",
    path: ["rules", "due_date_window", "max_days_overdue"],
    label: "Atraso máximo",
    unit: "días",
  },
  {
    kind: "ratio",
    path: ["rules", "field_low_confidence", "min_confidence"],
    label: "Confianza mínima de lectura",
  },
];

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
  const unit =
    spec.kind === "usd"
      ? "USD"
      : spec.kind === "percent"
        ? "%"
        : spec.kind === "int"
          ? spec.unit
          : "0 a 1";
  return (
    <label className="flex items-center justify-between gap-3 text-[13px]">
      <span className="text-ink-2">{spec.label}</span>
      <span className="flex items-center gap-1.5">
        <input
          key={value}
          defaultValue={value}
          inputMode="decimal"
          disabled={disabled}
          onBlur={(e) => {
            const next = stored(spec, e.target.value);
            if (next !== null) onChange(write(yaml, spec.path, next));
          }}
          className="num h-8 w-32 rounded-[var(--radius-control)] border border-control bg-surface px-2 text-right text-ink disabled:opacity-60"
        />
        <span className="w-10 text-[12px] text-ink-3">{unit}</span>
      </span>
    </label>
  );
}

export function PolicyWorkbench({
  initialYaml,
  version,
  signedBy,
  protectedKeys,
  canSign,
}: {
  readonly initialYaml: string;
  readonly version: number;
  readonly signedBy: string;
  readonly protectedKeys: readonly ProtectedKey[];
  /** Hay un aprobador elegido para firmar. */
  readonly canSign: boolean;
}) {
  const [yaml, setYaml] = useState(initialYaml);
  const [preview, runPreview, previewing] = useActionState(previewAction, null);
  // El YAML con el que se calculó la vista previa: si se edita después, queda desactualizada.
  const [previewedYaml, setPreviewedYaml] = useState<string | null>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const stale = preview !== null && previewedYaml !== yaml;
  // El resultado aparece debajo del editor: se lleva a la vista y recibe el foco, así se ve
  // y el lector de pantalla lo lee sin buscarlo.
  useEffect(() => {
    if (preview?.ok) {
      previewHeading.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      previewHeading.current?.focus({ preventScroll: true });
    }
  }, [preview]);
  const [saved, runSave, saving] = useActionState(saveAction, null);
  const dialog = useRef<HTMLDialogElement>(null);
  const parsed = useMemo(() => read(yaml), [yaml]);
  const dirty = yaml !== initialYaml;

  const form = (
    <div className="space-y-5">
      {!parsed.ok ? (
        <p
          role="alert"
          className="rounded-[var(--radius-control)] bg-hold-tint px-3 py-2 text-[13px] text-hold"
        >
          El YAML tiene errores de sintaxis: corrígelo para volver a usar el formulario.
        </p>
      ) : null}
      <fieldset className="space-y-2">
        <legend className="mb-2 text-[12px] font-medium tracking-wide text-ink-2 uppercase">
          Límites
        </legend>
        {LIMITS.map((spec) => (
          <NumberField
            key={spec.path.join(".")}
            spec={spec}
            yaml={yaml}
            onChange={setYaml}
            disabled={!parsed.ok}
          />
        ))}
        <label className="flex items-center justify-between gap-3 text-[13px]">
          <span className="text-ink-2">Periodo del presupuesto</span>
          <select
            value={String(parsed.get(["limits", "budget", "period"]) ?? "month")}
            disabled={!parsed.ok}
            onChange={(e) => setYaml(write(yaml, ["limits", "budget", "period"], e.target.value))}
            className="h-8 w-[10.5rem] rounded-[var(--radius-control)] border border-control bg-surface px-2 text-ink"
          >
            <option value="month">mes</option>
            <option value="week">semana</option>
          </select>
        </label>
      </fieldset>

      <fieldset className="space-y-1.5">
        <legend className="mb-2 text-[12px] font-medium tracking-wide text-ink-2 uppercase">
          Acción por regla
        </legend>
        {CONFIGURABLE_RULES.map((code: RuleCode) => (
          <label key={code} className="flex items-center justify-between gap-3 text-[13px]">
            <span className="text-ink">
              {RULES[code].title}
              <span className="ml-1.5 font-mono text-[11px] text-ink-3">{code}</span>
            </span>
            <select
              value={String(parsed.get(["rules", code, "on_fail"]) ?? "")}
              disabled={!parsed.ok}
              onChange={(e) => setYaml(write(yaml, ["rules", code, "on_fail"], e.target.value))}
              className="h-8 rounded-[var(--radius-control)] border border-control bg-surface px-2 text-ink"
            >
              <option value="escalar">ESCALAR</option>
              <option value="frenar">FRENAR</option>
            </select>
          </label>
        ))}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="mb-2 text-[12px] font-medium tracking-wide text-ink-2 uppercase">
          Parámetros
        </legend>
        {PARAMETERS.map((spec) => (
          <NumberField
            key={spec.path.join(".")}
            spec={spec}
            yaml={yaml}
            onChange={setYaml}
            disabled={!parsed.ok}
          />
        ))}
      </fieldset>
    </div>
  );

  const editor = (
    <label className="flex flex-col gap-1">
      <span className="sr-only">Política en YAML</span>
      <textarea
        value={yaml}
        onChange={(e) => setYaml(e.target.value)}
        spellCheck={false}
        rows={40}
        className="min-h-[32rem] w-full rounded-[var(--radius-card)] border border-line bg-surface-sunken p-4 font-mono text-[12px] leading-relaxed text-ink"
      />
    </label>
  );

  const actions = (
    <div className="flex w-full flex-wrap items-center gap-2">
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
        onClick={() => dialog.current?.showModal()}
        className="h-8 rounded-[var(--radius-control)] bg-ink px-3 text-[13px] font-medium text-surface disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-3"
      >
        Guardar como v{version + 1}
      </button>
      {dirty ? (
        <button
          type="button"
          onClick={() => setYaml(initialYaml)}
          className="text-[13px] text-ink-2 underline underline-offset-4"
        >
          Descartar cambios
        </button>
      ) : null}
      {!canSign ? (
        <span className="text-[12px] text-ink-3">Elige quién firma para poder guardar.</span>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-4">
      <PolicyEditor
        version={version}
        signedBy={signedBy}
        form={form}
        yaml={editor}
        protectedKeys={protectedKeys}
        actions={actions}
      />

      {preview?.ok === false ? (
        <div
          role="alert"
          className="rounded-[var(--radius-card)] bg-hold-tint px-4 py-3 text-[13px] text-hold"
        >
          <p className="font-medium">La política no es válida:</p>
          <ul className="mt-1 list-disc pl-5">
            {preview.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {preview?.ok ? (
        <section
          aria-label="Qué cambiaría"
          className="rounded-[var(--radius-card)] border border-line bg-surface p-4"
        >
          {stale ? (
            <p className="mb-2 text-[12px] font-medium text-ink">
              Editaste la política después de calcular: vuelve a ver qué cambiaría.
            </p>
          ) : null}
          <h2
            ref={previewHeading}
            tabIndex={-1}
            className={`text-[13px] font-medium text-ink outline-none ${stale ? "opacity-60" : ""}`}
          >
            {preview.changes.length === 0
              ? `Ninguna de las ${String(preview.evaluated - preview.skipped)} facturas abiertas cambiaría de veredicto.`
              : `${String(preview.changes.length)} de ${String(preview.evaluated - preview.skipped)} facturas abiertas cambiarían de veredicto:`}
          </h2>
          {preview.changes.length > 0 ? (
            <ul className="mt-3 divide-y divide-line text-[13px]">
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
            <p className="mt-2 text-[12px] text-ink-3">
              {preview.skipped} sin lectura guardada no se pueden reevaluar.
            </p>
          ) : null}
        </section>
      ) : null}

      <ActionOutcome state={saved} />

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
