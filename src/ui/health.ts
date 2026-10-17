import type { HealthReport, HealthStatus } from "@/src/usecases";

import { duration } from "./format";

/**
 * Las filas de Salud en palabras de pantalla: las muestran la página y `/api/health`, así
 * las dos dicen lo mismo. Cada fila es verde o roja; el detalle dice por qué y qué hacer.
 */

export type HealthRow = {
  readonly key: "base" | "politica" | "proveedor" | "pendiente" | "escaladas" | "avisos";
  readonly label: string;
  readonly ok: boolean;
  readonly detail: string;
};

export const HEALTH_STATUS_LABEL: Readonly<Record<HealthStatus, string>> = {
  ok: "En orden",
  degradada: "Degradada",
  falla: "Con fallas",
};

const since = (iso: string, now: Date) => duration(now.getTime() - Date.parse(iso));
const ago = (iso: string, now: Date) => `hace ${since(iso, now)}`;

export function healthRows(report: HealthReport, now: Date): HealthRow[] {
  const { database, policy, model, operation } = report;
  const rows: HealthRow[] = [
    {
      key: "base",
      label: "Base de datos",
      ok: database.ok,
      detail: database.ok
        ? `Responde en ${duration(database.latencyMs ?? 0)}`
        : `No responde (${database.error ?? "sin detalle"}). Revisa la conexión a la base.`,
    },
    {
      key: "politica",
      label: "Política vigente",
      ok: policy.ok,
      detail: policy.ok
        ? policy.version === null
          ? "La plantilla de la empresa de la demo carga y valida"
          : `Versión ${String(policy.version)}`
        : database.ok
          ? "No hay política vigente: el agente no paga nada. Firma una en Reglas."
          : "Sin datos: la base no responde",
    },
    {
      key: "proveedor",
      label: "Proveedor de lectura",
      ok: model.ok,
      detail: modelDetail(report, now),
    },
  ];
  if (!operation) return rows;
  const oldest = operation.oldestWaitingSince;
  rows.push(
    {
      key: "pendiente",
      label: "Pendiente más antiguo",
      ok: operation.expired === 0,
      detail:
        oldest === null
          ? "Nada espera a una persona"
          : operation.expired > 0
            ? `Lleva ${since(oldest, now)} esperando; ${String(operation.expired)} ya vencieron su plazo de aprobación`
            : `Lleva ${since(oldest, now)} esperando`,
    },
    {
      key: "escaladas",
      label: "Escaladas abiertas",
      ok: true,
      detail:
        operation.waiting === 0
          ? "Ninguna"
          : `${String(operation.waiting)} ${operation.waiting === 1 ? "espera" : "esperan"} a una persona`,
    },
    {
      key: "avisos",
      label: "Avisos fallidos",
      ok: operation.failedNotifications === 0,
      detail:
        operation.failedNotifications === 0
          ? "Ninguno"
          : `${String(operation.failedNotifications)} sin entregar. Revisa el canal de avisos.`,
    },
  );
  return rows;
}

function modelDetail(report: HealthReport, now: Date): string {
  const { model } = report;
  if (model.primary === null) {
    return "Sin clave: las facturas se escalan como ilegibles y nunca se pagan";
  }
  const last = model.lastCall;
  if (last === null) return `${model.primary} · sin llamadas todavía`;
  if (!model.ok) {
    return `${model.primary} · la última llamada falló ${ago(last.created_at, now)} (${last.error ?? "sin detalle"})`;
  }
  return `${model.primary} · última llamada ${ago(last.created_at, now)}`;
}
