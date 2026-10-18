import {
  formatMoney,
  type Finding,
  type InvoiceStatus,
  type Money,
  type Verdict,
} from "@/src/domain";

import { decisionSummary, reasonFor } from "./reasons";

/**
 * Los mensajes del bot de Telegram (D24), en el HTML que admite Telegram. Puro y probado.
 *
 * Todo valor que viene de afuera (beneficiario, nombre de la empresa, razones con texto del
 * documento) pasa por `escapeTelegramHtml`: Telegram interpreta `<`, `>` y `&`, y un nombre
 * de beneficiario no puede convertirse en un enlace ni romper el mensaje (P-130).
 */

/** Telegram corta los mensajes de más de 4.096 caracteres. */
const MAX_MESSAGE = 4000;
/** Razones que caben en un aviso; el resto se ve en el detalle. */
const MAX_REASONS = 3;

export function escapeTelegramHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const clip = (html: string) =>
  html.length > MAX_MESSAGE ? `${html.slice(0, MAX_MESSAGE)}…` : html;

export type DecisionNotice = {
  readonly verdict: Verdict;
  readonly status: InvoiceStatus;
  readonly reference: string;
  readonly payeeName: string | null;
  readonly amount: Money | null;
  readonly findings: readonly Finding[];
  /** Quien aprobó, si la decisión la tomó una persona. */
  readonly approvedBy: string | null;
};

const MARK: Readonly<Record<Verdict, string>> = { pagar: "✅", escalar: "⚠️", frenar: "⛔" };

/**
 * El aviso de una decisión: qué pasó, de quién y cuánto, por qué (las razones en lenguaje
 * simple, las que frenan primero) y qué puede hacer la persona.
 */
export function decisionNotice(notice: DecisionNotice): string {
  const summary = decisionSummary(notice.verdict, notice.status, notice.findings);
  const headline = notice.approvedBy
    ? `Aprobada por ${escapeTelegramHtml(notice.approvedBy)}. Orden de pago preparada.`
    : escapeTelegramHtml(summary.headline);
  const who = [
    notice.payeeName ? `<b>${escapeTelegramHtml(notice.payeeName)}</b>` : null,
    notice.amount ? escapeTelegramHtml(formatMoney(notice.amount)) : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");
  const reasons = [...notice.findings]
    .sort((a, b) => (a.action === b.action ? 0 : a.action === "frenar" ? -1 : 1))
    .slice(0, MAX_REASONS)
    .map((f) => {
      const r = reasonFor(f);
      return `• <b>${escapeTelegramHtml(r.title)}</b>: ${escapeTelegramHtml(r.detail)}`;
    });
  const lines = [
    `${MARK[notice.verdict]} <b>${headline}</b>`,
    who,
    `<code>${escapeTelegramHtml(notice.reference)}</code>`,
    reasons.length > 0 && !notice.approvedBy ? `\nPor qué:\n${reasons.join("\n")}` : null,
    notice.approvedBy ? null : `\n${escapeTelegramHtml(summary.next)}`,
  ];
  return clip(lines.filter((line) => line !== null && line !== "").join("\n"));
}

export type SampleSummary = {
  readonly total: number;
  readonly pagar: number;
  readonly escalar: number;
  readonly frenar: number;
};

/** Un solo mensaje al terminar las facturas de ejemplo, en vez de un aviso por cada una. */
export function sampleSummaryNotice(summary: SampleSummary): string {
  const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;
  return [
    `📋 <b>Facturas de ejemplo de hoy: ${String(summary.total)}</b>`,
    `✅ ${plural(summary.pagar, "pagada", "pagadas")} dentro de tus reglas`,
    `⚠️ ${plural(summary.escalar, "espera", "esperan")} tu decisión`,
    `⛔ ${plural(summary.frenar, "frenada", "frenadas")}`,
  ].join("\n");
}

/** Respuestas fijas del bot. Las que llevan valores de afuera los escapan. */
export const TELEGRAM_TEXT = {
  private:
    "Este bot es privado. Para conectarlo, entra a Yunque, abre «Conectar» y usa «Conectar Telegram».",
  linked: (organization: string) =>
    `Listo: este chat quedó conectado a <b>${escapeTelegramHtml(organization)}</b>.\n\nTe aviso cuando una factura necesite tu decisión o se frene. También puedes enviarme una factura en PDF o foto y te digo qué decidió el agente.\n\nPara desconectar, escribe /salir.`,
  linkInvalid: "Ese enlace ya se usó o venció. Genera uno nuevo en Yunque con «Conectar Telegram».",
  help: "Envíame una factura en PDF o como foto y te digo qué decidió el agente. Para desconectar este chat, escribe /salir.",
  unlinked: "Listo, desconecté este chat. Ya no te llegarán avisos.",
  received: "Recibida. La estoy revisando; en unos segundos te digo qué decidió el agente.",
  duplicate: "Esa factura ya la recibí.",
  tooLarge: (maxMb: number) =>
    `El archivo pesa más de ${String(maxMb)} MB. Envía uno más liviano o solo las páginas de la factura.`,
  limit: (max: number) =>
    `Llegaste al máximo de ${String(max)} facturas por hoy en este chat. Vuelve mañana.`,
  notProcessed: (reason: string) => `No pude procesar el archivo: ${escapeTelegramHtml(reason)}`,
} as const;
