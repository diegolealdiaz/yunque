import { cache } from "react";

import {
  currentBusinessDate,
  loadCurrentPolicy,
  loadInbox,
  startOfBusinessDay,
  type HealthStatus,
  type Inbox,
} from "@/src/usecases";

import type { HealthLevel, ShellState } from "../_components/sidebar";

import { appContext } from "./context";
import { healthReport } from "./health";

/**
 * Datos de la bandeja y de la barra lateral, una vez por petición: el contador de la barra
 * y la sección de pendientes salen de la misma lectura, así nunca discrepan (P-101).
 */

export type InboxView = Inbox & {
  /** Día de negocio para los vencimientos. En la demo, el del dataset. */
  readonly today: string;
  /** Modo demo: sin trabajo del día, la bandeja guía a procesar el periodo de ejemplo. */
  readonly demo: boolean;
};

export const inboxView = cache(async (): Promise<InboxView> => {
  const { config, db, organization } = await appContext();
  const now = new Date();
  const inbox = await loadInbox(db, organization.id, {
    decidedSince: startOfBusinessDay(now, config.displayTimeZone).toISOString(),
    now,
  });
  return {
    ...inbox,
    today: currentBusinessDate(
      { demo: config.demo.enabled, timeZone: config.displayTimeZone },
      now,
    ),
    demo: config.demo.enabled,
  };
});

/** El estado de salud como lo nombra la barra lateral. */
const HEALTH_LEVEL: Readonly<Record<HealthStatus, HealthLevel>> = {
  ok: "ok",
  degradada: "degradada",
  falla: "caida",
};

export const shellState = cache(async (): Promise<ShellState> => {
  const { db, organization } = await appContext();
  const [inbox, policy, health] = await Promise.all([
    inboxView(),
    loadCurrentPolicy(db, organization.id),
    healthReport(() => Promise.resolve(organization.id)),
  ]);
  return {
    organizationName: organization.name,
    pendingCount: inbox.waiting.length,
    // Sin política no hay mandato: la barra lo muestra como pagos apagados.
    controls: policy?.content.controls ?? {
      payments_enabled: false,
      dry_run: false,
      autonomy: "recomendar",
    },
    health: HEALTH_LEVEL[health.status],
  };
});
