import { parseDocument, stringify as stringifyYaml } from "yaml";
import { z } from "zod";

import { Sha256Schema, jsonHash, type Sha256 } from "./hash";
import { UlidSchema } from "./ids";
import { PositiveMoneySchema, formatMoney, money } from "./money";
import { OnFailSchema, RULES, type OnFail, type RuleCode } from "./rules";

/**
 * Política: el mandato que el agente ejecuta. Es un documento inmutable y versionado.
 *
 * Tres capas:
 * - `PolicySchema`: la política completa, lo que se guarda y lo que el motor evalúa.
 * - `PolicyEditSchema`: lo que el formulario y el YAML pueden cambiar. No incluye las
 *   claves protegidas (`protected`) ni los controles (`controls`), que se cambian aparte.
 * - `applyPolicyEdit`: produce la política nueva a partir de la vigente y una edición.
 *   La edición se valida estricta: si trae claves protegidas o de control, es un error.
 *
 * Los esquemas son estrictos: una clave desconocida es un error, no se ignora. Las reglas
 * no configurables no aparecen en `rules`: su acción es la de fábrica del catálogo.
 */

export const POLICY_SCHEMA_VERSION = 1;

export const PeriodSchema = z.enum(["month", "week"]);
export type Period = z.infer<typeof PeriodSchema>;

export const AutonomySchema = z.enum(["recomendar", "decidir"]);
export type Autonomy = z.infer<typeof AutonomySchema>;

const BasisPoints = z.number().int().min(0).max(10_000); // 500 = 5 %
const Days = z.number().int().min(0).max(365);
const Confidence = z.number().min(0).max(1);

/** Parámetros por regla. Cada regla configurable lleva `on_fail`; los umbrales viven aquí. */
export const RuleSettingsSchema = z.strictObject({
  payee_not_allowed: z.strictObject({ on_fail: OnFailSchema }),
  vendor_velocity: z.strictObject({
    on_fail: OnFailSchema,
    max_invoices: z.number().int().min(1).max(1000),
    window_days: Days.min(1),
  }),
  budget_exceeded: z.strictObject({ on_fail: OnFailSchema }),
  duplicate_invoice: z.strictObject({ on_fail: OnFailSchema, window_days: Days.min(1) }),
  amount_mismatch: z.strictObject({ on_fail: OnFailSchema, tolerance_bp: BasisPoints }),
  first_payment_to_vendor: z.strictObject({ on_fail: OnFailSchema }),
  amount_unusual_for_vendor: z.strictObject({
    on_fail: OnFailSchema,
    deviation_bp: BasisPoints,
    min_history: z.number().int().min(1).max(100),
  }),
  due_date_window: z.strictObject({
    on_fail: OnFailSchema,
    schedule_days_before: Days,
    max_days_overdue: Days,
  }),
  field_low_confidence: z.strictObject({
    min_confidence: Confidence,
    /** Campos críticos: por debajo del mínimo escalan siempre. `amount` es el total. */
    critical_fields: z
      .array(
        z.enum([
          "payee_name",
          "amount",
          "currency",
          "bank_account",
          "bank_holder",
          "invoice_number",
          "due_date",
          "hours",
          "purchase_order",
        ]),
      )
      .min(1),
  }),
});
export type RuleSettings = z.infer<typeof RuleSettingsSchema>;

/** Reglas cuya acción se lee de `rules.<code>.on_fail`. */
type ConfigurableRuleCode = {
  [K in keyof RuleSettings]: RuleSettings[K] extends { on_fail: OnFail } ? K : never;
}[keyof RuleSettings];

/** Parte editable por la empresa desde formulario o YAML. Todos los límites van en USD. */
export const PolicyEditSchema = z.strictObject({
  limits: z.strictObject({
    /** Límite por pago. Por encima: frenar. Nunca supera el tope del sistema. */
    per_payment: PositiveMoneySchema.extend({ currency: z.literal("USD") }),
    /** Umbral de aprobación humana. Por encima: escalar. */
    approval_threshold: PositiveMoneySchema.extend({ currency: z.literal("USD") }),
    budget: z.strictObject({
      amount: z.number().int().positive(),
      currency: z.literal("USD"),
      period: PeriodSchema,
    }),
  }),
  /** Ids de vendors permitidos. Un beneficiario fuera de la lista no se paga. */
  allowed_payees: z.array(UlidSchema).max(1000),
  rules: RuleSettingsSchema,
});
export type PolicyEdit = z.infer<typeof PolicyEditSchema>;

/** Claves que el formulario muestra pero no edita. Las fija el despliegue o un administrador. */
export const ProtectedSchema = z.strictObject({
  /** Tope absoluto por pago en centavos de USD. Viene de configuración, no del formulario. */
  system_hard_cap_usd_cents: z.number().int().positive(),
  /** Cuenta origen de los pagos, identificada por su id en la plataforma. */
  source_account_id: z.string().min(1).max(100),
  /** Personas que pueden liberar un escalado. */
  approvers: z.array(z.string().min(1).max(200)).min(1).max(50),
});
export type Protected = z.infer<typeof ProtectedSchema>;

/** Interruptores de control. No son política: se cambian con confirmación y quedan en bitácora. */
export const ControlsSchema = z.strictObject({
  payments_enabled: z.boolean(),
  dry_run: z.boolean(),
  autonomy: AutonomySchema,
  /**
   * Doble firma: aflojar la política, encender un interruptor, registrar un proveedor o
   * aprobar lo que uno corrigió pide a otra persona de la lista. Las políticas guardadas antes
   * de existir el interruptor la traen encendida.
   */
  four_eyes: z.boolean().default(true),
});
export type Controls = z.infer<typeof ControlsSchema>;

export const PolicySchema = z.strictObject({
  schema_version: z.literal(POLICY_SCHEMA_VERSION),
  ...PolicyEditSchema.shape,
  protected: ProtectedSchema,
  controls: ControlsSchema,
});
export type Policy = Readonly<z.infer<typeof PolicySchema>>;

/** Versión persistida: la política más su metadato de firma. Append-only. */
export const PolicyVersionSchema = z.strictObject({
  id: UlidSchema,
  organization_id: UlidSchema,
  version: z.number().int().positive(),
  content: PolicySchema,
  content_hash: Sha256Schema,
  signed_by: z.string().min(1).max(200),
  signed_at: z.iso.datetime(),
  note: z.string().max(500).optional(),
});
export type PolicyVersion = Readonly<z.infer<typeof PolicyVersionSchema>>;

export class PolicyError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`Política inválida:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "PolicyError";
    this.problems = problems;
  }
}

function problemsFrom(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.map(String).join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

/** Validaciones entre campos de la política. */
function crossChecks(policy: Policy): string[] {
  const problems: string[] = [];
  if (policy.limits.approval_threshold.amount > policy.limits.per_payment.amount) {
    problems.push("limits.approval_threshold no puede superar limits.per_payment");
  }
  if (policy.limits.per_payment.amount > policy.protected.system_hard_cap_usd_cents) {
    problems.push("limits.per_payment no puede superar el tope absoluto del sistema");
  }
  return problems;
}

/** Congela el objeto y todo lo que contiene. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

/** Valida una política completa y la devuelve congelada en profundidad. */
export function parsePolicy(input: unknown): Policy {
  const parsed = PolicySchema.safeParse(input);
  if (!parsed.success) throw new PolicyError(problemsFrom(parsed.error));
  const problems = crossChecks(parsed.data);
  if (problems.length > 0) throw new PolicyError(problems);
  return deepFreeze(parsed.data);
}

/** Valida la parte editable. Rechaza claves protegidas, de control o desconocidas. */
export function parsePolicyEdit(input: unknown): PolicyEdit {
  const parsed = PolicyEditSchema.safeParse(input);
  if (!parsed.success) throw new PolicyError(problemsFrom(parsed.error));
  return parsed.data;
}

/**
 * Aplica una edición sobre la política vigente. Las claves protegidas y los controles
 * se copian de la vigente; la edición se valida estricta antes de mezclarse.
 */
export function applyPolicyEdit(current: Policy, edit: PolicyEdit): Policy {
  const clean = parsePolicyEdit(edit);
  return parsePolicy({
    schema_version: POLICY_SCHEMA_VERSION,
    ...clean,
    protected: current.protected,
    controls: current.controls,
  });
}

/** Límite por pago efectivo en centavos de USD: el menor entre la política y el tope del sistema. */
export function effectiveHardCapUsdCents(policy: Policy): number {
  return Math.min(policy.limits.per_payment.amount, policy.protected.system_hard_cap_usd_cents);
}

function isConfigurable(policy: Policy, code: RuleCode): code is ConfigurableRuleCode {
  const settings: Partial<Record<RuleCode, unknown>> = policy.rules;
  const entry = settings[code];
  return typeof entry === "object" && entry !== null && "on_fail" in entry;
}

/** Acción para una regla: la configurada si la regla lo admite, la de fábrica si no. */
export function onFailOf(policy: Policy, code: RuleCode): OnFail {
  return isConfigurable(policy, code) ? policy.rules[code].on_fail : RULES[code].defaultOnFail;
}

/** Hash del contenido de la política, estable ante el orden de las claves. */
export function policyHash(policy: Policy): Sha256 {
  return jsonHash(policy);
}

// ---------------------------------------------------------------------------
// Cuatro ojos: lo que una política nueva afloja frente a la vigente.
// ---------------------------------------------------------------------------

/** Nombre de cada regla configurable en las frases de lo que se afloja. */
const LOOSENED_RULE_NAME: readonly (readonly [ConfigurableRuleCode, string])[] = [
  ["payee_not_allowed", "beneficiario fuera de la lista"],
  ["vendor_velocity", "muchas facturas seguidas del mismo beneficiario"],
  ["budget_exceeded", "se pasa del presupuesto"],
  ["duplicate_invoice", "factura duplicada"],
  ["amount_mismatch", "cobra distinto a lo acordado"],
  ["first_payment_to_vendor", "primer pago a un beneficiario"],
  ["amount_unusual_for_vendor", "monto fuera de lo habitual"],
  ["due_date_window", "factura muy vencida"],
];

const usd = (cents: number) => formatMoney(money(cents, "USD"));
const pct = (bp: number) => `${String(bp / 100).replace(".", ",")} %`;

/**
 * Lo que la candidata afloja frente a la vigente, en frases para la persona que aprueba:
 * un límite o un umbral más alto, un beneficiario nuevo en la lista, una regla que pasa de
 * frenar a escalar, una tolerancia más amplia o una ventana más corta. Vacía si la candidata
 * es igual o más estricta. Un cambio así no entra en vigor con una sola firma: pagaría lo que
 * hoy no se paga solo.
 */
export function policyLoosenings(current: Policy, candidate: Policy): string[] {
  const out: string[] = [];
  const was = current.limits;
  const now = candidate.limits;
  if (now.per_payment.amount > was.per_payment.amount) {
    out.push(
      `Sube el límite por pago de ${usd(was.per_payment.amount)} a ${usd(now.per_payment.amount)}`,
    );
  }
  if (now.approval_threshold.amount > was.approval_threshold.amount) {
    out.push(
      `Sube el umbral de aprobación de ${usd(was.approval_threshold.amount)} a ${usd(now.approval_threshold.amount)}`,
    );
  }
  if (now.budget.amount > was.budget.amount) {
    out.push(`Sube el presupuesto de ${usd(was.budget.amount)} a ${usd(now.budget.amount)}`);
  }
  if (now.budget.period !== was.budget.period) {
    out.push("Cambia el periodo del presupuesto, que vuelve a empezar");
  }
  const added = candidate.allowed_payees.filter((id) => !current.allowed_payees.includes(id));
  if (added.length > 0) {
    out.push(
      added.length === 1
        ? "Agrega un beneficiario a la lista de permitidos"
        : `Agrega ${String(added.length)} beneficiarios a la lista de permitidos`,
    );
  }
  for (const [code, name] of LOOSENED_RULE_NAME) {
    if (current.rules[code].on_fail === "frenar" && candidate.rules[code].on_fail === "escalar") {
      out.push(`«${name}» pasa de frenar a escalar`);
    }
  }
  const r = current.rules;
  const c = candidate.rules;
  if (c.vendor_velocity.max_invoices > r.vendor_velocity.max_invoices) {
    out.push(
      `Admite más facturas seguidas del mismo beneficiario (${String(r.vendor_velocity.max_invoices)} a ${String(c.vendor_velocity.max_invoices)})`,
    );
  }
  if (c.vendor_velocity.window_days < r.vendor_velocity.window_days) {
    out.push(
      `Acorta la ventana de facturas seguidas (${String(r.vendor_velocity.window_days)} a ${String(c.vendor_velocity.window_days)} días)`,
    );
  }
  if (c.duplicate_invoice.window_days < r.duplicate_invoice.window_days) {
    out.push(
      `Acorta la ventana de duplicados (${String(r.duplicate_invoice.window_days)} a ${String(c.duplicate_invoice.window_days)} días)`,
    );
  }
  if (c.amount_mismatch.tolerance_bp > r.amount_mismatch.tolerance_bp) {
    out.push(
      `Amplía la tolerancia frente a lo acordado (${pct(r.amount_mismatch.tolerance_bp)} a ${pct(c.amount_mismatch.tolerance_bp)})`,
    );
  }
  if (c.amount_unusual_for_vendor.deviation_bp > r.amount_unusual_for_vendor.deviation_bp) {
    out.push(
      `Amplía la desviación admitida sobre lo habitual (${pct(r.amount_unusual_for_vendor.deviation_bp)} a ${pct(c.amount_unusual_for_vendor.deviation_bp)})`,
    );
  }
  if (c.amount_unusual_for_vendor.min_history > r.amount_unusual_for_vendor.min_history) {
    out.push(
      `Pide más pagos previos para vigilar montos atípicos (${String(r.amount_unusual_for_vendor.min_history)} a ${String(c.amount_unusual_for_vendor.min_history)})`,
    );
  }
  if (c.due_date_window.max_days_overdue > r.due_date_window.max_days_overdue) {
    out.push(
      `Admite más días de atraso (${String(r.due_date_window.max_days_overdue)} a ${String(c.due_date_window.max_days_overdue)})`,
    );
  }
  if (c.field_low_confidence.min_confidence < r.field_low_confidence.min_confidence) {
    out.push(
      `Baja la confianza mínima de lectura (${String(r.field_low_confidence.min_confidence)} a ${String(c.field_low_confidence.min_confidence)})`,
    );
  }
  const dropped = r.field_low_confidence.critical_fields.filter(
    (f) => !c.field_low_confidence.critical_fields.includes(f),
  );
  if (dropped.length > 0) {
    out.push(`Deja de vigilar la confianza de ${String(dropped.length)} campos críticos`);
  }
  return out;
}

/**
 * Lo que un cambio de interruptores afloja: encender los pagos, apagar el modo de prueba,
 * dejar que el agente decida o apagar la doble firma. Lo contrario nunca afloja: va con una
 * firma, y apagar los pagos es la emergencia.
 */
export function controlsLoosenings(from: Controls, to: Controls): string[] {
  const out: string[] = [];
  if (!from.payments_enabled && to.payments_enabled) {
    out.push("Vuelve a encender los pagos: el agente paga lo que cumple las reglas");
  }
  if (from.dry_run && !to.dry_run) {
    out.push("Apaga el modo de prueba: las decisiones vuelven a preparar órdenes de pago");
  }
  if (from.autonomy === "recomendar" && to.autonomy === "decidir") {
    out.push("El agente pasa de recomendar a decidir: paga solo lo que cumple las reglas");
  }
  if (from.four_eyes && !to.four_eyes) {
    out.push(
      "Apaga la doble firma: una sola persona podrá aflojar las reglas, registrar proveedores y aprobar lo que corrigió",
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// YAML. Solo el esquema core de YAML 1.2: sin etiquetas personalizadas ni anclas.
// ---------------------------------------------------------------------------

const MAX_YAML_CHARS = 100_000;
const YAML_OPTIONS = { schema: "core", merge: false, maxAliasCount: 0 } as const;

/** Extrae la parte editable de la política como texto YAML para la pantalla de Reglas. */
export function policyEditToYaml(policy: Policy): string {
  const edit: PolicyEdit = {
    limits: policy.limits,
    allowed_payees: policy.allowed_payees,
    rules: policy.rules,
  };
  return stringifyYaml(edit, { ...YAML_OPTIONS, lineWidth: 0, sortMapEntries: false });
}

/**
 * Lee el YAML del editor. Rechaza errores y advertencias del parser (claves duplicadas,
 * etiquetas desconocidas, varios documentos) y después valida el esquema estricto.
 */
export function policyEditFromYaml(text: string): PolicyEdit {
  if (text.length > MAX_YAML_CHARS) throw new PolicyError(["El YAML supera el tamaño máximo"]);
  const doc = parseDocument(text, { ...YAML_OPTIONS, uniqueKeys: true });
  const messages = [...doc.errors, ...doc.warnings].map((e) => e.message.split("\n")[0] ?? "");
  if (messages.length > 0) throw new PolicyError(messages);
  let data: unknown;
  try {
    data = doc.toJS({ maxAliasCount: 0 });
  } catch (error) {
    throw new PolicyError([error instanceof Error ? error.message : "YAML inválido"]);
  }
  return parsePolicyEdit(data);
}

/** Política de fábrica para una empresa nueva. Los ids de vendors se agregan después. */
export function defaultPolicy(input: {
  systemHardCapUsdCents: number;
  sourceAccountId: string;
  approvers: readonly string[];
}): Policy {
  const rules: RuleSettings = {
    payee_not_allowed: { on_fail: "escalar" },
    vendor_velocity: { on_fail: "escalar", max_invoices: 5, window_days: 7 },
    budget_exceeded: { on_fail: "frenar" },
    duplicate_invoice: { on_fail: "frenar", window_days: 90 },
    amount_mismatch: { on_fail: "escalar", tolerance_bp: 500 },
    first_payment_to_vendor: { on_fail: "escalar" },
    amount_unusual_for_vendor: { on_fail: "escalar", deviation_bp: 5000, min_history: 3 },
    due_date_window: { on_fail: "escalar", schedule_days_before: 3, max_days_overdue: 30 },
    field_low_confidence: {
      min_confidence: 0.85,
      critical_fields: ["payee_name", "amount", "currency", "bank_account", "invoice_number"],
    },
  };
  return parsePolicy({
    schema_version: POLICY_SCHEMA_VERSION,
    limits: {
      per_payment: { amount: Math.min(2_000_000, input.systemHardCapUsdCents), currency: "USD" },
      approval_threshold: {
        amount: Math.min(500_000, input.systemHardCapUsdCents),
        currency: "USD",
      },
      budget: { amount: 10_000_000, currency: "USD", period: "month" },
    },
    allowed_payees: [],
    rules,
    protected: {
      system_hard_cap_usd_cents: input.systemHardCapUsdCents,
      source_account_id: input.sourceAccountId,
      approvers: [...input.approvers],
    },
    controls: { payments_enabled: true, dry_run: false, autonomy: "decidir" },
  });
}
