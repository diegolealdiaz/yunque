"use server";

import { loadInvoiceList } from "@/src/usecases";

import { appContext } from "../_data/context";

/**
 * La factura que el recorrido abre para mostrar el porqué y la decisión: una que espera a una
 * persona, porque ahí se ve el panel completo; si no hay, una frenada, que explica un riesgo
 * real; si no, la más reciente. Solo lee: el recorrido nunca cambia datos.
 */
export async function tourInvoice(): Promise<string | null> {
  const { db, organization } = await appContext();
  const rows = await loadInvoiceList(db, organization.id, {}, new Date());
  const pick =
    rows.find((r) => r.status === "esperando_aprobacion") ??
    rows.find((r) => r.decided?.verdict === "frenar") ??
    rows[0];
  return pick?.invoiceId ?? null;
}
