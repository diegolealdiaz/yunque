"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AgentProgress, useAgentProgress } from "../../_components/agent-progress";
import { ProcessResponseSchema, errorMessage } from "../facturas/api-responses";

/**
 * Procesa un caso de la galería por el lote (`/api/lote`), el mismo camino que "Procesar
 * facturas de ejemplo", y abre su detalle: ahí se ve qué decidió el agente y por qué. Mientras
 * decide, la tarjeta muestra los pasos del agente encima de la factura.
 */
export function TryCase({ caso }: { readonly caso: string }) {
  const router = useRouter();
  const progress = useAgentProgress();
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setMessage(null);
    try {
      const outcome = await progress.run(async () => {
        const response = await fetch("/api/lote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ caso }),
        });
        const body: unknown = await response.json().catch(() => null);
        return { ok: response.ok, body };
      });
      const parsed = ProcessResponseSchema.safeParse(outcome.body);
      if (!outcome.ok || !parsed.success) {
        progress.reset();
        setMessage(errorMessage(outcome.body, "No se pudo procesar. Intenta de nuevo."));
        return;
      }
      // Los pasos quedan a la vista hasta que abre el detalle.
      router.push(`/facturas/${parsed.data.invoiceId}`);
    } catch {
      progress.reset();
      setMessage("Se cortó la conexión. Intenta de nuevo.");
    }
  }

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => void run()}
        disabled={progress.step !== null}
        className="h-9 w-full rounded-[var(--radius-control)] bg-brand-tint px-3 text-[13px] font-semibold text-brand hover:bg-brand hover:text-on-brand disabled:opacity-70"
      >
        {progress.step !== null ? "El agente está decidiendo…" : "Ver qué decide"}
      </button>
      {progress.step !== null ? (
        <div className="absolute inset-0 z-10 flex flex-col justify-center gap-4 bg-surface/92 p-6 backdrop-blur-sm motion-safe:animate-[fade-in_200ms_ease-out]">
          <p className="caps text-brand">El agente está decidiendo</p>
          <AgentProgress step={progress.step} />
        </div>
      ) : null}
      {message ? (
        <p role="alert" className="text-[12px] text-hold">
          {message}
        </p>
      ) : null}
    </div>
  );
}
