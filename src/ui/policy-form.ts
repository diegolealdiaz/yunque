import { parseDocument } from "yaml";

import type { RuleCode } from "@/src/domain/rules";

/**
 * El formulario de Reglas sobre el YAML de la política (docs/interfaz.md §5.4). Puro: la
 * pantalla solo dibuja. El formulario lee y escribe claves concretas del mismo documento que
 * se edita en «Como código»; el servidor valida la política entera al ver qué cambiaría y al
 * guardar.
 *
 * Unidades: el YAML guarda montos en centavos de USD (los límites de la política son en USD
 * por esquema) y tolerancias en puntos básicos; el formulario muestra dólares y porcentajes.
 * Cada ruta de campo existe en la política de fábrica: una prueba lo verifica, así renombrar
 * una clave en el dominio no deja el campo mostrando un guion.
 */

export type Path = readonly (string | number)[];

type FieldBase = {
  readonly path: Path;
  readonly label: string;
  /** Qué controla el campo, en una frase que entienda quien no leyó el código. */
  readonly help: string;
};

export type FieldSpec =
  | (FieldBase & { readonly kind: "usd" })
  | (FieldBase & { readonly kind: "int"; readonly unit: string })
  | (FieldBase & { readonly kind: "percent" })
  | (FieldBase & { readonly kind: "ratio" });

export const LIMIT_FIELDS: readonly FieldSpec[] = [
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

export const BUDGET_PERIOD_PATH: Path = ["limits", "budget", "period"];

export const PARAMETER_FIELDS: readonly FieldSpec[] = [
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

/** Lee un valor de la política por su ruta. */
export type PolicyGetter = (path: Path) => unknown;

/** Número de la política para una frase; si el YAML no lo trae, un guion. */
export function num(raw: unknown): string {
  return typeof raw === "number" ? String(raw) : "—";
}

/** Puntos básicos como porcentaje: 500 → «5 %». */
export function percent(raw: unknown): string {
  return typeof raw === "number" ? `${String(raw / 100)} %` : "—";
}

export type RuleCopy = {
  readonly label: string;
  /** Qué dispara la regla, con los valores vigentes de la política dentro de la frase. */
  readonly help: (get: PolicyGetter) => string;
};

/**
 * Cada regla configurable dicha como lo que la dispara. El título del dominio sigue en el
 * YAML y en el código. Una prueba exige una entrada por cada regla configurable.
 */
export const RULE_COPY: Readonly<Partial<Record<RuleCode, RuleCopy>>> = {
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

/** El YAML leído una vez: si tiene errores de sintaxis y cómo consultar cada clave. */
export function readPolicyYaml(yaml: string): { readonly ok: boolean; readonly get: PolicyGetter } {
  const doc = parseDocument(yaml);
  return { ok: doc.errors.length === 0, get: (path) => doc.getIn(path) };
}

/** El YAML con una clave cambiada, conservando el resto del documento y sus comentarios. */
export function writePolicyYaml(yaml: string, path: Path, value: unknown): string {
  const doc = parseDocument(yaml);
  doc.setIn(path, value);
  return doc.toString({ lineWidth: 0 });
}

/** La unidad que se muestra al lado del campo. */
export function unitOf(spec: FieldSpec): string {
  switch (spec.kind) {
    case "usd":
      return "USD";
    case "percent":
      return "%";
    case "int":
      return spec.unit;
    case "ratio":
      return "0 a 1";
  }
}

/** Valor del YAML como se muestra en el formulario. */
export function displayValue(spec: FieldSpec, raw: unknown): string {
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

/**
 * Lo que la persona escribe, convertido al valor que guarda el YAML, o el motivo por el que
 * no vale. Acepta coma o punto decimal. El servidor vuelve a validar al guardar.
 */
export function parseFieldInput(
  spec: FieldSpec,
  text: string,
):
  { readonly ok: true; readonly value: number } | { readonly ok: false; readonly message: string } {
  const n = Number(text.trim().replace(",", "."));
  if (text.trim() === "" || !Number.isFinite(n)) {
    return { ok: false, message: "Escribe un número." };
  }
  if (n < 0) return { ok: false, message: "No puede ser negativo." };
  switch (spec.kind) {
    case "usd":
      return { ok: true, value: Math.round(n * 100) };
    case "percent":
      return { ok: true, value: Math.round(n * 100) };
    case "int":
      return Number.isInteger(n)
        ? { ok: true, value: n }
        : { ok: false, message: "Escribe un número entero." };
    case "ratio":
      return n <= 1 ? { ok: true, value: n } : { ok: false, message: "Va de 0 a 1." };
  }
}
