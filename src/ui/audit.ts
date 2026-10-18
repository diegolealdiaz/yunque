import {
  ChannelSchema,
  ControlsSchema,
  FindingCodeSchema,
  VerdictSchema,
  type Controls,
  type EventType,
} from "@/src/domain";

import { usdMicros } from "./format";
import { ARRIVAL_LABEL, RULE_REASON } from "./labels";

/**
 * Cada evento de la bitácora dicho para el cliente (docs/interfaz.md §5.6): qué pasó en una
 * frase, por qué o con qué en otra, y un tono con el color del veredicto. Los datos crudos
 * siguen en la tabla de auditoría y se ven aparte, para quien audita.
 */

export type AuditTone = "pay" | "hold" | "escalate" | "brand" | "neutral";

export type AuditLine = {
  readonly title: string;
  readonly detail: string | null;
  readonly tone: AuditTone;
};

/**
 * Pasos internos de cada factura: llegó, se preparó, se leyó. Son ciertos y quedan en la
 * bitácora, pero lo que el cliente busca son las decisiones y lo que hicieron las personas.
 */
export const STEP_EVENTS: readonly EventType[] = [
  "invoice.received",
  "invoice.processing",
  "invoice.normalized",
  "invoice.extracted",
  "llm.called",
  "llm.failed",
];

const num = (value: unknown): number | null => (typeof value === "number" ? value : null);
const str = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

/** Por qué un correo real no se procesó (D23). */
const EMAIL_REJECTED: Readonly<Record<string, string>> = {
  expired: "La dirección de correo ya venció",
  address_limit: "La dirección llegó a su máximo de correos de hoy",
  daily_limit: "La demo llegó a su máximo de correos de hoy",
  invoice_limit: "Se llegó al máximo de facturas de hoy",
};

const CHANNEL_NAME: Readonly<Record<string, string>> = {
  telegram: "Telegram",
  email: "correo",
};

/** La regla que decidió, en una frase; null si el evento no la trae. */
function reason(raw: unknown): string | null {
  const code = FindingCodeSchema.safeParse(raw);
  return code.success ? RULE_REASON[code.data] : null;
}

/** Qué interruptor cambió, en una frase; la primera diferencia entre antes y después. */
function controlChange(from: Controls, to: Controls): string {
  if (from.payments_enabled !== to.payments_enabled) {
    return to.payments_enabled ? "Encendió los pagos" : "Apagó los pagos";
  }
  if (from.dry_run !== to.dry_run) {
    return to.dry_run ? "Encendió el modo de prueba" : "Apagó el modo de prueba";
  }
  if (from.autonomy !== to.autonomy) {
    return to.autonomy === "decidir"
      ? "Dejó que el agente decida"
      : "Pasó el agente a solo recomendar";
  }
  if (from.four_eyes !== to.four_eyes) {
    return to.four_eyes ? "Encendió la doble firma" : "Apagó la doble firma";
  }
  return "Cambió los interruptores";
}

function decision(d: Readonly<Record<string, unknown>>): AuditLine {
  const verdict = VerdictSchema.safeParse(d["verdict"]);
  const seed = d["seed"] === true;
  const rule = reason(d["deciding_rule"]);
  const why = rule ?? (seed ? "Del historial de ejemplo, antes de la demo" : null);
  if (!verdict.success) return { title: "Decidió la factura", detail: why, tone: "neutral" };
  switch (verdict.data) {
    case "pagar":
      return {
        title: d["dry_run"] === true ? "La habría pagado" : "Aprobó el pago",
        detail:
          d["dry_run"] === true
            ? "En modo de prueba: no se preparó la orden"
            : seed
              ? "Del historial de ejemplo, antes de la demo"
              : "Cumplió todas tus reglas",
        tone: "pay",
      };
    case "frenar":
      return { title: "Frenó la factura", detail: why, tone: "hold" };
    case "escalar":
      return { title: "La pasó a una persona", detail: why, tone: "escalate" };
  }
}

export function describeEvent(type: EventType, d: Readonly<Record<string, unknown>>): AuditLine {
  switch (type) {
    case "invoice.received": {
      const channel = ChannelSchema.safeParse(d["channel"]);
      return {
        title: channel.success ? ARRIVAL_LABEL[channel.data] : "Llegó una factura",
        detail: null,
        tone: "neutral",
      };
    }
    case "invoice.processing":
      return {
        title: d["retry"] === true ? "Reintentó la lectura" : "Empezó a leerla",
        detail: str(d["reason"]),
        tone: "neutral",
      };
    case "invoice.normalized": {
      const pages = num(d["pages"]);
      return {
        title: "Preparó el documento",
        detail: pages === null ? null : `${String(pages)} ${pages === 1 ? "página" : "páginas"}`,
        tone: "neutral",
      };
    }
    case "invoice.extracted": {
      if (d["kind"] === "not_invoice") {
        return { title: "Leyó el documento: no es una factura", detail: null, tone: "neutral" };
      }
      if (d["kind"] !== "invoice") {
        return { title: "No pudo leer el documento", detail: null, tone: "neutral" };
      }
      const cost = num(d["cost_usd_micros"]);
      return {
        title: "Leyó la factura",
        detail:
          d["from_cache"] === true
            ? "Ya la había leído: sin costo"
            : cost === null
              ? null
              : `Costo de lectura ${usdMicros(cost)}`,
        tone: "neutral",
      };
    }
    case "invoice.decided":
    case "invoice.escalated":
      return decision(d);
    case "invoice.approved":
      return {
        title: "Aprobó el pago",
        detail: d["dry_run"] === true ? "En modo de prueba: no se preparó la orden" : null,
        tone: "pay",
      };
    case "invoice.rejected":
      return { title: "Rechazó la factura", detail: str(d["reason"]), tone: "hold" };
    case "invoice.corrected":
      return {
        title: "Corrigió datos a mano",
        detail: "Otra persona debe aprobar lo que pagaría",
        tone: "brand",
      };
    case "invoice.failed":
      return {
        title: "No se pudo procesar",
        detail: "Se puede reintentar desde la factura; mientras tanto no se paga",
        tone: "hold",
      };
    case "policy.saved": {
      const version = num(d["version"]);
      const previous = num(d["previous"]);
      return {
        title: version === null ? "Firmó la política" : `Firmó la política v${String(version)}`,
        detail: previous === null ? "Primera versión" : `Reemplaza la v${String(previous)}`,
        tone: "brand",
      };
    }
    case "policy.proposed": {
      const base = num(d["base_version"]);
      const loosened = Array.isArray(d["loosenings"]) ? d["loosenings"].length : 0;
      return {
        title: "Propuso un cambio que afloja las reglas",
        detail: `${String(loosened)} ${loosened === 1 ? "cambio" : "cambios"} sobre la v${String(base ?? "?")}; entra en vigor con la firma de otra persona`,
        tone: "escalate",
      };
    }
    case "policy.proposal_closed": {
      const version = num(d["version"]);
      const outcome = str(d["outcome"]);
      return {
        title:
          outcome === "aprobada"
            ? "Dio la segunda firma al cambio de reglas"
            : "Descartó el cambio de reglas propuesto",
        detail:
          outcome === "aprobada" && version !== null
            ? `Queda en vigor como la v${String(version)}`
            : null,
        tone: outcome === "aprobada" ? "brand" : "neutral",
      };
    }
    case "policy.replayed": {
      const evaluated = num(d["evaluated"]) ?? 0;
      const changed = num(d["changed"]) ?? 0;
      return {
        title: "Reevaluó las facturas abiertas",
        detail: `${String(evaluated)} revisadas, ${String(changed)} cambiaron de veredicto`,
        tone: "brand",
      };
    }
    case "controls.changed": {
      const from = ControlsSchema.safeParse(d["from"]);
      const to = ControlsSchema.safeParse(d["to"]);
      const version = num(d["version"]);
      return {
        title:
          from.success && to.success
            ? controlChange(from.data, to.data)
            : "Cambió los interruptores",
        detail: version === null ? null : `Queda en la política v${String(version)}`,
        tone: "brand",
      };
    }
    case "notification.sent": {
      const channel = str(d["channel"]);
      return {
        title: `Avisó por ${channel ? (CHANNEL_NAME[channel] ?? channel) : "un canal"}`,
        detail: d["simulated"] === true ? "Aviso simulado en la demo" : null,
        tone: "neutral",
      };
    }
    case "notification.failed":
      return {
        title: "No pudo enviar un aviso",
        detail: "El canal no respondió; la factura sigue en Pendientes",
        tone: "hold",
      };
    case "llm.called":
      return { title: "Consultó al modelo", detail: null, tone: "neutral" };
    case "llm.failed":
      return { title: "El modelo no respondió", detail: null, tone: "hold" };
    case "email.rejected": {
      const why = str(d["reason"]);
      return {
        title: "Un correo no se procesó",
        detail: why === null ? null : (EMAIL_REJECTED[why] ?? null),
        tone: "neutral",
      };
    }
    case "explanation.rated":
      return {
        title:
          d["clear"] === true
            ? "Dijo que la explicación fue clara"
            : "Dijo que la explicación no fue clara",
        detail: str(d["comment"]),
        tone: "neutral",
      };
    case "vendor.created": {
      const name = str(d["name"]);
      const account = str(d["account"]);
      return {
        title: name ? `Registró al proveedor ${name}` : "Registró un proveedor",
        detail:
          account === null
            ? null
            : `Cuenta ${account} · ${d["verified"] === true ? "verificado" : "falta que otra persona lo verifique"}`,
        tone: "brand",
      };
    }
    case "vendor.verified": {
      const name = str(d["name"]);
      return {
        title: name ? `Verificó al proveedor ${name}` : "Verificó un proveedor",
        detail: null,
        tone: "brand",
      };
    }
    case "vendor.account_changed":
      return { title: "Cambió la cuenta de un beneficiario", detail: null, tone: "escalate" };
  }
}
