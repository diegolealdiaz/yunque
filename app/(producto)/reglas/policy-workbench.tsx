"use client";

import { useActionState, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import { CONFIGURABLE_RULES, RULES, type RuleCode } from "@/src/domain/rules";
import type { PayeeOption } from "@/src/usecases";
import {
  ALLOWED_PAYEES_PATH,
  BUDGET_PERIOD_PATH,
  LIMIT_FIELDS,
  PARAMETER_FIELDS,
  RULE_COPY,
  displayValue,
  parseFieldInput,
  readPolicyYaml,
  readStringList,
  toggleListItem,
  unitOf,
  writePolicyYaml,
  type FieldSpec,
  type PolicyGetter,
} from "@/src/ui/policy-form";

import { ActionOutcome } from "../../_components/action-outcome";
import { PolicyEditor, type PolicyTab, type ProtectedKey } from "../../_components/policy-editor";

import { previewAction, saveAction } from "./actions";
import { PreviewDialog, SaveDialog } from "./policy-dialogs";

/**
 * Formulario y YAML de la política, sincronizados (docs/interfaz.md §5.4, P-106). Las dos
 * vistas editan el mismo documento YAML: el formulario lee y escribe claves concretas sobre
 * él (`src/ui/policy-form.ts`), y el YAML se edita entero. El navegador no valida la
 * política: el servidor la valida con el esquema estricto al ver qué cambiaría y al guardar.
 *
 * El formulario cabe en una pantalla: límites y parámetros a la izquierda, qué hacer cuando
 * una regla no se cumple a la derecha, y la barra de acciones fija abajo. "Ver qué cambiaría"
 * abre su resultado en un diálogo, desde donde se puede guardar sin buscarlo en la página.
 */

/**
 * Un campo numérico del formulario. Se confirma al salir del campo: un valor que no vale
 * queda escrito, con el motivo debajo, y no toca la política.
 */
function NumberField({
  spec,
  get,
  onCommit,
  disabled,
}: {
  readonly spec: FieldSpec;
  readonly get: PolicyGetter;
  readonly onCommit: (value: number) => void;
  readonly disabled: boolean;
}) {
  const value = displayValue(spec, get(spec.path));
  const helpId = useId();
  const errorId = useId();
  const [error, setError] = useState<string | null>(null);
  return (
    <label className="flex items-center justify-between gap-4 py-2 text-[13px]">
      <span className="min-w-0">
        <span className="block text-ink">{spec.label}</span>
        <span id={helpId} className="block text-[12px] leading-snug text-ink-3">
          {spec.help}
        </span>
        {error ? (
          <span id={errorId} role="alert" className="block text-[12px] text-hold">
            {error}
          </span>
        ) : null}
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        <input
          key={value}
          aria-describedby={error ? `${helpId} ${errorId}` : helpId}
          aria-invalid={error ? true : undefined}
          defaultValue={value}
          inputMode="decimal"
          disabled={disabled}
          onBlur={(e) => {
            const parsed = parseFieldInput(spec, e.target.value);
            setError(parsed.ok ? null : parsed.message);
            if (parsed.ok) onCommit(parsed.value);
          }}
          className="num h-8 w-28 rounded-[var(--radius-control)] border border-control bg-surface px-2 text-right text-ink disabled:opacity-60 aria-invalid:border-hold"
        />
        <span className="w-10 text-[12px] text-ink-3">{unitOf(spec)}</span>
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
    <fieldset className="card px-4 pt-3 pb-2">
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

/**
 * A quién puede pagar el agente sin preguntar: los beneficiarios registrados, cada uno con
 * su casilla. Uno fuera de la lista se escala o se frena según la regla de la derecha.
 */
function AllowedPayees({
  payees,
  allowed,
  onToggle,
  disabled,
}: {
  readonly payees: readonly PayeeOption[];
  readonly allowed: readonly string[];
  readonly onToggle: (id: string, on: boolean) => void;
  readonly disabled: boolean;
}) {
  const known = new Set(payees.map((p) => p.id));
  const orphans = allowed.filter((id) => !known.has(id)).length;
  if (payees.length === 0) {
    return (
      <p className="py-2 text-[13px] text-ink-3">La empresa no tiene beneficiarios registrados.</p>
    );
  }
  return (
    <div className="py-1">
      <p className="py-1 text-[12px] text-ink-3">
        {allowed.length - orphans} de {payees.length} permitidos
        {orphans > 0 ? ` · ${String(orphans)} en la lista ya no están registrados` : ""}
      </p>
      <ul className="max-h-56 overflow-y-auto">
        {payees.map((payee) => (
          <li key={payee.id}>
            <label
              className={`flex items-center gap-3 rounded-[var(--radius-control)] px-1 py-1.5 text-[13px] hover:bg-surface-hover ${
                disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
              }`}
            >
              <input
                type="checkbox"
                checked={allowed.includes(payee.id)}
                disabled={disabled}
                onChange={(e) => onToggle(payee.id, e.target.checked)}
                className="size-4 shrink-0 accent-[var(--brand)]"
              />
              <span className="min-w-0 flex-1 truncate text-ink">{payee.name}</span>
              <span className="font-mono text-[11px] text-ink-3">{payee.country}</span>
              <span
                className={`w-20 text-right text-[12px] ${payee.verified ? "text-ink-2" : "text-ink-3"}`}
              >
                {payee.verified ? "verificado" : "sin verificar"}
              </span>
            </label>
          </li>
        ))}
      </ul>
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
  payees,
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
  /** Beneficiarios registrados, para la lista de permitidos. */
  readonly payees: readonly PayeeOption[];
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
  const parsed = useMemo(() => readPolicyYaml(yaml), [yaml]);
  const allowed = useMemo(() => readStringList(yaml, ALLOWED_PAYEES_PATH), [yaml]);
  const setAt = (path: readonly (string | number)[], value: unknown) =>
    setYaml(writePolicyYaml(yaml, path, value));
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
            {LIMIT_FIELDS.map((spec) => (
              <NumberField
                key={spec.path.join(".")}
                spec={spec}
                get={parsed.get}
                onCommit={(value) => setAt(spec.path, value)}
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
                value={String(parsed.get(BUDGET_PERIOD_PATH) ?? "month")}
                disabled={!parsed.ok}
                onChange={(e) => setAt(BUDGET_PERIOD_PATH, e.target.value)}
                // El margen alinea el selector con los campos numéricos: ancho de la unidad
                // (w-10) más su separación (gap-1.5).
                className="mr-[2.875rem] h-8 w-28 rounded-[var(--radius-control)] border border-control bg-surface px-2 text-ink"
              >
                <option value="month">mes</option>
                <option value="week">semana</option>
              </select>
            </label>
          </Group>
          <Group title="Parámetros" hint="Tolerancias y plazos que usan las reglas.">
            {PARAMETER_FIELDS.map((spec) => (
              <NumberField
                key={spec.path.join(".")}
                spec={spec}
                get={parsed.get}
                onCommit={(value) => setAt(spec.path, value)}
                disabled={!parsed.ok}
              />
            ))}
          </Group>
          <Group
            title="A quién se puede pagar"
            hint="Beneficiarios a los que el agente paga sin preguntar. Uno fuera de la lista sigue la regla «Beneficiario fuera de la lista»."
          >
            <AllowedPayees
              payees={payees}
              allowed={allowed}
              disabled={!parsed.ok}
              onToggle={(id, on) => setYaml(toggleListItem(yaml, ALLOWED_PAYEES_PATH, id, on))}
            />
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
              onChange={(next) => setAt(["rules", code, "on_fail"], next)}
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
        className="h-8 btn-primary px-3 text-[13px]"
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

      <PreviewDialog
        dialogRef={previewDialog}
        preview={preview}
        stale={stale}
        canSave={dirty && canSign && !saving}
        version={version}
        onSave={openSave}
      />
      <SaveDialog dialogRef={dialog} yaml={yaml} version={version} onSubmit={runSave} />
    </div>
  );
}
