"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ProcessResponseSchema, errorMessage } from "../facturas/api-responses";

/**
 * Procesa un caso de la galería por el lote (`/api/lote`), el mismo camino que "Procesar
 * facturas de ejemplo", y abre su detalle: ahí se ve qué decidió el agente y por qué.
 */
export function TryCase({ caso }: { readonly caso: string }) {
  const router = useRouter();
  const [state, setState] = useState<"listo" | "leyendo" | "error">("listo");
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setState("leyendo");
    setMessage(null);
    try {
      const response = await fetch("/api/lote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caso }),
      });
      const body: unknown = await response.json().catch(() => null);
      const parsed = ProcessResponseSchema.safeParse(body);
      if (!response.ok || !parsed.success) {
        setState("error");
        setMessage(errorMessage(body, "No se pudo procesar. Intenta de nuevo."));
        return;
      }
      router.push(`/facturas/${parsed.data.invoiceId}`);
    } catch {
      setState("error");
      setMessage("Se cortó la conexión. Intenta de nuevo.");
    }
  }

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => void run()}
        disabled={state === "leyendo"}
        className="h-9 w-full rounded-[var(--radius-control)] bg-brand-tint px-3 text-[13px] font-semibold text-brand hover:bg-brand hover:text-on-brand disabled:opacity-70"
      >
        {state === "leyendo" ? "El agente la está leyendo…" : "Ver qué decide"}
      </button>
      {message ? (
        <p role="alert" className="text-[12px] text-hold">
          {message}
        </p>
      ) : null}
    </div>
  );
}
