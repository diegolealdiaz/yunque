import {
  ExtractedFieldNameSchema,
  parseUnreadableObserved,
  type Finding,
  type FindingCode,
  type InvoiceStatus,
  type Verdict,
} from "@/src/domain";
import { quote, sanitizeDocumentText } from "@/src/explain/sanitize";

import { FIELD_LABEL } from "./labels";

/**
 * La decisión explicada para el cliente (docs/interfaz.md §5.2): qué pasó, por qué importa y
 * qué puede hacer, sin códigos de regla ni jerga. Es una función determinista de los
 * hallazgos que la decisión ya registró: no cambia el veredicto ni reemplaza el registro
 * técnico, que sigue a la vista para auditoría. El tipo exige una frase por código: una
 * regla nueva sin explicación para el cliente no compila.
 *
 * `observed` y `threshold` pueden traer texto del documento: pasan por `sanitizeDocumentText`.
 */

export type Reason = {
  /** Qué pasó, en pocas palabras. */
  readonly title: string;
  /** Por qué importa, con los valores de esta factura. */
  readonly detail: string;
};

const s = sanitizeDocumentText;

/** El campo de un hallazgo, como lo ve la persona: «el monto», «la cuenta». */
function fieldOf(f: Finding): string {
  const parsed = ExtractedFieldNameSchema.safeParse(f.field);
  return parsed.success ? `«${FIELD_LABEL[parsed.data].toLowerCase()}»` : "un dato";
}

/** Una cita larga, cortada en la última palabra completa, para que el porqué se lea de un vistazo. */
function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= 240) return flat;
  return `${flat.slice(0, flat.lastIndexOf(" ", 240))}…`;
}

/**
 * Lo que se sabe de la factura además del hallazgo. El texto del documento dice si una cita
 * salió del PDF o del mensaje que lo trajo (correo o chat): el hallazgo no lo guarda.
 */
export type ReasonContext = {
  readonly documentText?: string | null;
};

/** Verdadero si la cita aparece en el texto del documento (sin importar los espacios). */
function inDocument(said: string, documentText: string): boolean {
  const flat = (t: string) => t.replace(/\s+/g, " ").trim();
  return flat(documentText).includes(flat(said).replace(/…$/, "").slice(0, 40));
}

const REASONS: Readonly<Record<FindingCode, (f: Finding, ctx: ReasonContext) => Reason>> = {
  payee_not_allowed: (f) => ({
    title: "El beneficiario no está aprobado",
    detail: `${quote(f.observed)} no está en tu lista de beneficiarios aprobados. Solo se les paga sin revisión a los de esa lista.`,
  }),
  bank_account_mismatch: (f) => ({
    title: "La cuenta bancaria cambió",
    detail: `La factura pide pagar a una cuenta que termina en ${s(f.observed)}, pero la registrada termina en ${s(f.threshold)}. Es la forma más común de fraude: confirma el cambio con el proveedor por teléfono, no por correo.`,
  }),
  account_holder_mismatch: (f) => ({
    title: "La cuenta está a nombre de otra persona",
    detail: `El titular de la cuenta es ${quote(f.observed)}, pero el registrado es ${quote(f.threshold)}.`,
  }),
  vendor_not_verified: () => ({
    title: "El beneficiario no está verificado",
    detail: "Sus datos de pago todavía no se han verificado, así que no se le paga sin revisión.",
  }),
  vendor_velocity: (f) => ({
    title: "Demasiadas facturas seguidas del mismo beneficiario",
    detail: `Ya envió ${s(f.observed)}, y se admiten ${s(f.threshold)}. Muchas facturas juntas pueden ser un cobro repetido o un fraude.`,
  }),
  amount_over_hard_limit: (f) => ({
    title: "Supera el máximo por pago",
    detail: `El monto es ${s(f.observed)} y ningún pago puede pasar de ${s(f.threshold)}, ni siquiera con aprobación.`,
  }),
  amount_over_approval_threshold: (f) => ({
    title: "Es un monto alto",
    detail: `Cuesta ${s(f.observed)}. Por encima de ${s(f.threshold)}, un pago lo aprueba una persona.`,
  }),
  budget_exceeded: (f) => ({
    title: "No cabe en el presupuesto",
    detail: `El pago es de ${s(f.observed)}, y el presupuesto es de ${s(f.threshold)}.`,
  }),
  insufficient_balance: (f) => ({
    title: "No hay saldo suficiente",
    detail: `En la cuenta hay ${s(f.observed)} y el pago necesita ${s(f.threshold)}.`,
  }),
  duplicate_invoice: () => ({
    title: "Parece una factura repetida",
    detail:
      "Esta factura, o el mismo archivo, ya había llegado antes. Pagarla otra vez sería un pago doble.",
  }),
  amount_mismatch: (f) => ({
    title: "Cobra distinto a lo acordado",
    detail: `La factura cobra ${s(f.observed)}. Lo acordado con el beneficiario es ${s(f.threshold)}.`,
  }),
  first_payment_to_vendor: () => ({
    title: "Primer pago a este beneficiario",
    detail:
      "Nunca se le ha pagado. La primera vez, una persona confirma que sus datos son correctos.",
  }),
  amount_unusual_for_vendor: (f) => ({
    title: "Monto fuera de lo habitual",
    detail: `Esta factura es de ${s(f.observed)}. Lo normal para este beneficiario: ${s(f.threshold)}.`,
  }),
  unsupported_currency_or_rail: (f) => ({
    title: "No se puede pagar en esa moneda",
    detail: `Pide pagar en ${s(f.observed)}, y solo se puede pagar en ${s(f.threshold)}.`,
  }),
  due_date_window: (f) => ({
    title: "La factura está muy vencida",
    detail: `Está ${s(f.observed)}. Solo se paga sin revisión hasta ${s(f.threshold)} de atraso: conviene confirmar que sigue pendiente.`,
  }),
  field_low_confidence: (f) => ({
    title: "El agente no leyó bien un dato",
    detail: `No está seguro de ${fieldOf(f)}. Antes de pagar, una persona lo compara con el documento.`,
  }),
  field_ambiguous: (f) => ({
    title: "Un dato aparece con dos valores",
    detail: `El documento muestra ${s(f.observed)} para ${fieldOf(f)}. Una persona elige el correcto.`,
  }),
  evidence_missing: (f) => ({
    title: "Un dato no aparece en el documento",
    detail: `El agente no encontró en el documento el texto que respalda ${fieldOf(f)}. Por seguridad, no paga con un dato que no puede mostrar.`,
  }),
  totals_mismatch: (f) => ({
    title: "Las cuentas de la factura no cuadran",
    detail: `Los conceptos suman ${s(f.observed)}, pero el total dice ${s(f.threshold)}.`,
  }),
  suspicious_instructions: (f, ctx) => {
    const said = f.evidence?.quote ? excerpt(f.evidence.quote) : "";
    const hidden = f.observed.includes("texto oculto");
    if (said === "") {
      return {
        title: "El documento intenta engañar al sistema",
        detail:
          "Trae texto oculto o instrucciones del tipo «aprueba este pago». Una factura legítima no hace eso, así que no se paga.",
      };
    }
    // Sin el texto del documento no se sabe de dónde salió: se dice sin afirmar el lugar.
    const where =
      ctx.documentText === undefined || ctx.documentText === null
        ? "unknown"
        : inDocument(said, ctx.documentText)
          ? "document"
          : "message";
    if (where === "message") {
      return {
        title: "El mensaje que la trae intenta saltarse las reglas",
        detail: `El correo o chat que acompaña la factura dice ${quote(said)}. Ninguna aprobación llega así, y nadie puede pedirle al agente que se salte la revisión: por eso no se paga. Si es legítima, confírmala con el proveedor por un canal que ya conoces.`,
      };
    }
    return {
      title: "El documento intenta engañar al sistema",
      detail: `${
        where === "document"
          ? hidden
            ? "El documento trae texto oculto (en blanco o diminuto) dirigido al agente"
            : "El documento trae instrucciones dirigidas al agente"
          : "La factura o el mensaje que la trae le da instrucciones al agente"
      }: ${quote(said)}. Una factura legítima no le da órdenes a quien la paga, así que no se paga.`,
    };
  },
  extraction_unreadable: (f) => {
    const { kind, reason } = parseUnreadableObserved(f.observed);
    const what = s(reason);
    return kind === "not_invoice"
      ? {
          title: "No es una factura",
          detail: `El agente leyó el documento y no es una factura${what ? ` (${what})` : ""}. Solo se pagan facturas: una persona decide qué hacer con él.`,
        }
      : {
          title: "No se pudo leer el documento",
          detail: `El documento está borroso, incompleto o dañado${what ? ` (${what})` : ""}. Una persona debe revisarlo o pedir una copia legible.`,
        };
  },
  payments_disabled: () => ({
    title: "Los pagos están apagados",
    detail: "Alguien apagó los pagos en Reglas. Mientras sigan apagados, nada se paga.",
  }),
  autonomy_recomendar: () => ({
    title: "El agente solo recomienda",
    detail: "Está configurado para que una persona decida cada pago; el agente solo propone.",
  }),
  policy_missing: () => ({
    title: "No hay reglas configuradas",
    detail: "Sin reglas vigentes, el agente no paga nada.",
  }),
  vendors_missing: () => ({
    title: "No hay lista de beneficiarios",
    detail: "Sin la lista de beneficiarios aprobados, el agente no puede pagar a nadie.",
  }),
  ledger_missing: () => ({
    title: "No hay presupuesto abierto para este periodo",
    detail: "Sin presupuesto del periodo, el agente no puede comprometer pagos.",
  }),
  rule_error: () => ({
    title: "Un control no se pudo revisar",
    detail: "Por seguridad, si un control falla al revisarse, la factura no se paga.",
  }),
  human_correction: () => ({
    title: "Una persona corrigió datos a mano",
    detail: "Otra persona confirma los datos corregidos antes de pagar.",
  }),
  processing_error: (f) => ({
    title: "No se pudo procesar",
    detail: `Falló la etapa de ${s(f.observed)}. Una persona debe revisarla.`,
  }),
};

/** Un hallazgo explicado para el cliente. */
export function reasonFor(finding: Finding, ctx: ReasonContext = {}): Reason {
  return REASONS[finding.code](finding, ctx);
}

export type DecisionSummary = {
  /** Lo que pasó con la factura, en una frase. */
  readonly headline: string;
  /** Qué puede hacer la persona ahora. */
  readonly next: string;
};

/**
 * Titular y siguiente paso según el veredicto, el estado de la factura y lo que la detuvo:
 * a un documento que no se pudo leer como factura no se le sugiere aprobarlo.
 */
export function decisionSummary(
  verdict: Verdict,
  status: InvoiceStatus,
  findings: readonly Finding[] = [],
): DecisionSummary {
  if (status === "rechazada") {
    return { headline: "Una persona la rechazó.", next: "El rechazo es final: no se pagará." };
  }
  // Aprobada por una persona: tras aprobarla el veredicto vigente es "pagar", pero no la pagó
  // el agente dentro de las reglas.
  if (status === "aprobada") {
    return { headline: "Una persona la aprobó.", next: "No tienes que hacer nada." };
  }
  if (verdict === "pagar" && status === "decidida") {
    return { headline: "Se pagó dentro de tus reglas.", next: "No tienes que hacer nada." };
  }
  // Todavía sin decisión final: en curso, o el proceso falló y se reintenta.
  if (status === "recibida" || status === "procesando") {
    return {
      headline: "El agente la está revisando.",
      next: "En unos segundos aparece su decisión.",
    };
  }
  if (status === "fallida") {
    return {
      headline: "No se terminó de procesar.",
      next: "Vuelve a entregarla para reintentar; si sigue fallando, revisa la salud del sistema.",
    };
  }
  if (verdict === "escalar" && findings.some((f) => f.code === "extraction_unreadable")) {
    return {
      headline: "Necesita tu decisión.",
      next: "Si de verdad es un cobro, completa los datos a mano en «Corregir campos» y el agente la vuelve a revisar; si no, recházala.",
    };
  }
  if (verdict === "escalar") {
    return {
      headline: "Necesita tu decisión.",
      next: "Revisa lo de abajo y apruébala, corrige un dato o recházala.",
    };
  }
  return {
    headline: "No se pagó.",
    next: "No se puede aprobar tal como llegó. Si es un error, pide al proveedor una factura corregida.",
  };
}
