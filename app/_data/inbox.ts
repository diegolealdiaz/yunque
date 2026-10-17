import { cache } from "react";

import { getCurrentPolicy } from "@/src/db/repositories";
import { currentBusinessDate, loadInbox, startOfBusinessDay, type Inbox } from "@/src/usecases";

import type { ShellState } from "../_components/sidebar";

import { appContext } from "./context";

/**
 * Datos de la bandeja y de la barra lateral, una vez por petición: el contador de la barra
 * y la sección de pendientes salen de la misma lectura, así nunca discrepan (P-101).
 */

export type InboxView = Inbox & {
  /** Día de negocio para los vencimientos. En la demo, el del dataset. */
  readonly today: string;
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
  };
});

export const shellState = cache(async (): Promise<ShellState> => {
  const { config, db, organization } = await appContext();
  const [inbox, policy] = await Promise.all([inboxView(), getCurrentPolicy(db, organization.id)]);
  return {
    organizationName: organization.name,
    pendingCount: inbox.waiting.length,
    // Sin política no hay mandato: la barra lo muestra como pagos apagados.
    controls: policy?.content.controls ?? {
      payments_enabled: false,
      dry_run: false,
      autonomy: "recomendar",
    },
    health: policy === null ? "caida" : config.model === null ? "degradada" : "ok",
  };
});
