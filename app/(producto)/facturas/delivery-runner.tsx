"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { errorMessage } from "./api-responses";

/**
 * Entrega en vivo de una lista cerrada del dataset, una por petición y en orden, refrescando
 * la tabla después de cada una para que las filas cambien de estado a la vista. La usan
 * "Procesar periodo" (el lote) y "Leer bandeja" (los correos). Repetirla no duplica nada:
 * cada entrega tiene su llave.
 */
export function DeliveryRunner({
  endpoint,
  field,
  ids,
  label,
  noun,
  primary = false,
}: {
  /** Ruta que procesa una entrega: `/api/lote` o `/api/bandeja`. */
  readonly endpoint: string;
  /** Nombre del campo del cuerpo con el id: `caso` o `mensaje`. */
  readonly field: string;
  readonly ids: readonly string[];
  /** Texto del botón en infinitivo: "Procesar periodo", "Leer bandeja". */
  readonly label: string;
  /** Qué se procesa, en plural: "facturas", "correos". */
  readonly noun: string;
  readonly primary?: boolean;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [failures, setFailures] = useState<readonly string[]>([]);

  async function run() {
    setRunning(true);
    setDone(0);
    setFailures([]);
    for (const [index, id] of ids.entries()) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [field]: id }),
        });
        if (!response.ok) {
          const json: unknown = await response.json().catch(() => null);
          setFailures((all) => [...all, `${id}: ${errorMessage(json, "no se pudo procesar")}`]);
          // Un tope alcanzado detiene la entrega: las siguientes también se rechazarían.
          if (response.status === 429) break;
        }
      } catch {
        setFailures((all) => [...all, `${id}: sin conexión`]);
      }
      setDone(index + 1);
      router.refresh();
    }
    setRunning(false);
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => void run()}
        disabled={running}
        className={`h-8 rounded-[var(--radius-control)] px-3 text-[13px] font-medium disabled:cursor-wait disabled:opacity-70 ${
          primary ? "bg-ink text-surface" : "border border-control text-ink"
        }`}
      >
        {running ? "Procesando…" : label}
      </button>
      {/* Siempre presente, así el lector de pantalla anuncia cada avance, no solo el final. */}
      <span role="status" className="text-[13px] text-ink-2">
        {running || done > 0
          ? `${String(done)} de ${String(ids.length)} ${noun}${running ? "…" : ""}${failures.length > 0 ? ` · ${String(failures.length)} con error` : ""}`
          : ""}
      </span>
      {failures.length > 0 ? (
        <details className="text-[12px] text-hold">
          <summary className="cursor-pointer">Ver errores</summary>
          <ul>
            {failures.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
