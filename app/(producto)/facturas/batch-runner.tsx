"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { errorMessage } from "./api-responses";

/**
 * "Procesar periodo": procesa el lote del dataset una factura por petición, en orden, y
 * refresca la tabla después de cada una, así las filas cambian de estado en vivo. Es la
 * demostración de que el agente trabaja solo. Volver a procesarlo no duplica nada: cada
 * caso tiene su llave de entrega.
 */
export function BatchRunner({ cases }: { readonly cases: readonly string[] }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [failures, setFailures] = useState<readonly string[]>([]);

  async function run() {
    setRunning(true);
    setDone(0);
    setFailures([]);
    for (const [index, caso] of cases.entries()) {
      try {
        const response = await fetch("/api/lote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ caso }),
        });
        if (!response.ok) {
          const json: unknown = await response.json().catch(() => null);
          setFailures((all) => [...all, `${caso}: ${errorMessage(json, "no se pudo procesar")}`]);
          // Un tope alcanzado detiene el lote: las siguientes también se rechazarían.
          if (response.status === 429) break;
        }
      } catch {
        setFailures((all) => [...all, `${caso}: sin conexión`]);
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
        className="h-8 rounded-[var(--radius-control)] bg-ink px-3 text-[13px] font-medium text-surface disabled:cursor-wait disabled:opacity-70"
      >
        {running ? `Procesando ${String(done)} de ${String(cases.length)}…` : "Procesar periodo"}
      </button>
      {!running && done > 0 ? (
        <span role="status" className="text-[13px] text-ink-2">
          {done} de {cases.length} procesadas
          {failures.length > 0 ? ` · ${String(failures.length)} con error` : ""}
        </span>
      ) : null}
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
