import { pingDatabase, type Database } from "@/src/db/client";
import { getCurrentPolicy, readHealthSnapshot, type HealthSnapshot } from "@/src/db/repositories";
import type { Ulid } from "@/src/domain";

/**
 * Salud (docs/arquitectura.md §6 "Salud", docs/interfaz.md §5.7): lo que responde
 * `/api/health` y lo que muestran la pantalla de Salud y el punto de la barra lateral. Las
 * tres lecturas salen de aquí, así nunca discrepan.
 *
 * - Críticas: la base responde, hay política vigente y el proveedor del modelo está
 *   configurado y su última llamada no falló. Si una falla, el estado es `falla`.
 * - De operación: escaladas cuya espera venció y avisos que no se pudieron entregar. Si
 *   alguna falla, el estado es `degradada`: el agente sigue decidiendo, pero alguien tiene
 *   que mirar.
 */

export type HealthStatus = "ok" | "degradada" | "falla";

/** Una última llamada fallida al proveedor cuenta como caída durante este tiempo. */
export const PROVIDER_FAILURE_WINDOW_MS = 30 * 60_000;

export type HealthReport = {
  readonly status: HealthStatus;
  readonly checkedAt: string;
  readonly database: {
    readonly ok: boolean;
    readonly latencyMs: number | null;
    readonly error: string | null;
  };
  readonly policy: {
    readonly ok: boolean;
    /** Versión vigente; null si no hay empresa todavía o si no tiene política. */
    readonly version: number | null;
  };
  readonly model: {
    readonly ok: boolean;
    /** Modelo principal configurado; null si no hay clave. */
    readonly primary: string | null;
    readonly lastCall: HealthSnapshot["lastModelCall"];
  };
  /** Lo de la empresa de quien pregunta; null si todavía no hay empresa (visita nueva). */
  readonly operation: {
    readonly ok: boolean;
    readonly waiting: number;
    readonly oldestWaitingSince: string | null;
    readonly expired: number;
    readonly failedNotifications: number;
  } | null;
};

export type HealthInput = {
  /** null si no se pudo abrir la conexión. */
  readonly db: Database | null;
  readonly connectError?: string | null;
  /** La empresa de quien pregunta, si ya existe. Sin ella solo se revisa lo del sistema. */
  readonly organizationId: Ulid | null;
  /** Sin empresa: si la plantilla de la empresa de la demo carga y valida. */
  readonly templateReady: () => Promise<boolean>;
  readonly model: { readonly primary: string } | null;
  readonly now: Date;
};

export async function checkHealth(input: HealthInput): Promise<HealthReport> {
  const checkedAt = input.now.toISOString();
  const database = await checkDatabase(input);
  const db = input.db;
  if (!database.ok || db === null) {
    return {
      status: "falla",
      checkedAt,
      database,
      policy: { ok: false, version: null },
      model: { ok: false, primary: input.model?.primary ?? null, lastCall: null },
      operation: null,
    };
  }

  const [policy, snapshot] = input.organizationId
    ? await Promise.all([
        getCurrentPolicy(db, input.organizationId),
        readHealthSnapshot(db, input.organizationId, input.now),
      ])
    : [null, null];
  const policyCheck = input.organizationId
    ? { ok: policy !== null, version: policy?.version ?? null }
    : { ok: await input.templateReady(), version: null };

  const lastCall = snapshot?.lastModelCall ?? null;
  const providerFailing =
    lastCall !== null &&
    lastCall.status === "error" &&
    input.now.getTime() - Date.parse(lastCall.created_at) < PROVIDER_FAILURE_WINDOW_MS;
  const model = {
    ok: input.model !== null && !providerFailing,
    primary: input.model?.primary ?? null,
    lastCall,
  };

  const operation = snapshot
    ? {
        ok: snapshot.expired === 0 && snapshot.failedNotifications === 0,
        waiting: snapshot.waiting,
        oldestWaitingSince: snapshot.oldestWaitingSince,
        expired: snapshot.expired,
        failedNotifications: snapshot.failedNotifications,
      }
    : null;

  const status: HealthStatus =
    !policyCheck.ok || !model.ok ? "falla" : operation && !operation.ok ? "degradada" : "ok";
  return { status, checkedAt, database, policy: policyCheck, model, operation };
}

async function checkDatabase(input: HealthInput): Promise<HealthReport["database"]> {
  if (input.db === null) {
    return { ok: false, latencyMs: null, error: input.connectError ?? "Sin conexión" };
  }
  const started = performance.now();
  try {
    await pingDatabase(input.db);
    return { ok: true, latencyMs: Math.round(performance.now() - started), error: null };
  } catch (error) {
    // Solo el tipo de falla: el mensaje del driver puede traer la URL de la base.
    return {
      ok: false,
      latencyMs: null,
      error: error instanceof Error ? error.name : "Error desconocido",
    };
  }
}
