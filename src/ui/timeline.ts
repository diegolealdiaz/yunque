import { ChannelSchema, FindingCodeSchema, VerdictSchema } from "@/src/domain";
import type { TimelineItem } from "@/src/usecases";

import { usdMicros } from "./format";
import { CHANNEL_LABEL, RULE_SHORT_LABEL, VERDICT_PARTICIPLE } from "./labels";

/**
 * Cada evento de la bitácora como una línea de la historia de la factura (docs/interfaz.md
 * §5.2): recibida, leída, decidida, aprobada. Los eventos internos que no le dicen nada a la
 * persona (el paso a "en proceso") no se muestran.
 */

export type TimelineLine = {
  readonly id: string;
  readonly at: string;
  readonly label: string;
  readonly detail: string | null;
  readonly actor: string;
};

const num = (value: unknown): number | null => (typeof value === "number" ? value : null);
const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

function line(item: TimelineItem): Omit<TimelineLine, "id" | "at" | "actor"> | null {
  const d = item.data;
  switch (item.type) {
    case "invoice.received": {
      const channel = ChannelSchema.safeParse(d["channel"]);
      return { label: "Recibida", detail: channel.success ? CHANNEL_LABEL[channel.data] : null };
    }
    case "invoice.processing":
      return d["retry"] === true ? { label: "Reintento", detail: null } : null;
    case "invoice.normalized": {
      const pages = num(d["pages"]);
      return {
        label: "Normalizada",
        detail: pages === null ? null : `${String(pages)} ${pages === 1 ? "página" : "páginas"}`,
      };
    }
    case "invoice.extracted": {
      if (d["kind"] !== "invoice")
        return {
          label: str(d["kind"]) === "not_invoice" ? "No es una factura" : "No se pudo leer",
          detail: null,
        };
      const cost = num(d["cost_usd_micros"]);
      const detail =
        d["from_cache"] === true
          ? "desde caché, sin costo"
          : cost === null
            ? null
            : usdMicros(cost);
      return {
        label: "Leída",
        detail: d["fallback_used"] === true ? `${detail ?? ""} · segunda pasada` : detail,
      };
    }
    case "invoice.decided":
    case "invoice.escalated": {
      const verdict = VerdictSchema.safeParse(d["verdict"]);
      // La regla en palabras, no su código: la línea de tiempo la lee el cliente.
      const code = FindingCodeSchema.safeParse(d["deciding_rule"]);
      const rule = code.success ? RULE_SHORT_LABEL[code.data] : null;
      return {
        label: verdict.success
          ? `${VERDICT_PARTICIPLE[verdict.data].charAt(0).toUpperCase()}${VERDICT_PARTICIPLE[verdict.data].slice(1)}`
          : "Decidida",
        detail: rule,
      };
    }
    case "invoice.failed":
      return { label: "Falló el registro", detail: str(d["reason"]) };
    case "invoice.approved":
      return { label: "Aprobada", detail: null };
    case "invoice.rejected":
      return { label: "Rechazada", detail: str(d["reason"]) };
    case "invoice.corrected":
      return { label: "Corregida a mano", detail: null };
    case "notification.sent":
      return { label: "Notificada", detail: str(d["channel"]) };
    default:
      return null;
  }
}

export function timelineLines(items: readonly TimelineItem[]): TimelineLine[] {
  return items.flatMap((item) => {
    const l = line(item);
    return l ? [{ id: item.id, at: item.at, actor: item.actor, ...l }] : [];
  });
}

/**
 * El detalle de un evento suelto en palabras de producto, para la bitácora: la regla que
 * decidió, el canal, el costo de lectura. Null si el evento no tiene un detalle legible.
 */
export function eventDetail(item: TimelineItem): string | null {
  return line(item)?.detail ?? null;
}
