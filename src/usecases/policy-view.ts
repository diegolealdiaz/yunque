import type { Database } from "@/src/db/client";
import {
  getCurrentPolicy,
  listEvents,
  listPolicyVersions,
  listVendors,
} from "@/src/db/repositories";
import { maskAccount, type PolicyVersion, type Rail, type Ulid } from "@/src/domain";

/**
 * Lecturas de la política para las pantallas: la vigente y su historial. Escribir una
 * versión nueva (guardar, interruptores) está en `policy.ts`.
 */

/** La versión vigente de la política, o null si la empresa todavía no tiene. */
export function loadCurrentPolicy(
  db: Database,
  organizationId: Ulid,
): Promise<PolicyVersion | null> {
  return getCurrentPolicy(db, organizationId);
}

/** Un beneficiario registrado, como opción de la lista de permitidos en Reglas. */
export type PayeeOption = {
  readonly id: Ulid;
  readonly name: string;
  readonly country: string;
  /** Una persona confirmó sus datos. */
  readonly verified: boolean;
  /** Cuenta registrada, enmascarada (`****6789`), y cómo se le paga. */
  readonly account: string;
  readonly rail: Rail;
};

/** Beneficiarios registrados de la empresa, por nombre, para elegir a quién se puede pagar. */
export async function loadPayeeOptions(db: Database, organizationId: Ulid): Promise<PayeeOption[]> {
  const vendors = await listVendors(db, organizationId);
  return vendors
    .map((v) => ({
      id: v.id,
      name: v.name,
      country: v.country,
      verified: v.verification.status === "verificado",
      account: maskAccount(v.account.account_number),
      rail: v.account.rail,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

/** Lo que pasó la última vez que se guardó una política y se reevaluaron las abiertas. */
export type LastReplay = {
  readonly who: string;
  readonly at: string;
  readonly version: number;
  /** Abiertas reevaluadas, sin las que no tenían lectura guardada. */
  readonly reevaluated: number;
  readonly changed: number;
};

export type PolicyHistory = {
  readonly current: PolicyVersion | null;
  /** Todas las versiones, la más nueva primero. */
  readonly versions: readonly PolicyVersion[];
  readonly lastReplay: LastReplay | null;
};

/**
 * La política vigente, sus versiones y la última reevaluación. Esta sale de la bitácora: es
 * lo que pasó al guardar, no un aviso efímero.
 */
export async function loadPolicyHistory(
  db: Database,
  organizationId: Ulid,
): Promise<PolicyHistory> {
  const [current, versions, replays] = await Promise.all([
    getCurrentPolicy(db, organizationId),
    listPolicyVersions(db, organizationId),
    listEvents(db, organizationId, { type: "policy.replayed", limit: 1 }),
  ]);
  const replay = replays[0];
  return {
    current,
    versions,
    lastReplay: replay
      ? {
          who: replay.actor.kind === "humano" ? replay.actor.name : "el agente",
          at: replay.occurred_at,
          version: Number(replay.data["version"]),
          reevaluated: Number(replay.data["evaluated"]) - Number(replay.data["skipped"] ?? 0),
          changed: Number(replay.data["changed"]),
        }
      : null,
  };
}
