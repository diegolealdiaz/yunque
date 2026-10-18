"use client";

import { useRef, useState } from "react";

import { CheckIcon } from "./icons";

/**
 * Lo que hace el agente con cada factura, en el orden del proceso: leer, verificar, aplicar
 * las reglas y redactar el porqué. Se muestra mientras decide, para que el cliente vea el
 * trabajo y no un salto directo al resultado.
 */
export const AGENT_STEPS = [
  "Leyendo la factura",
  "Verificando cada dato contra el documento",
  "Aplicando tus reglas",
  "Escribiendo el porqué",
] as const;

/** Lo mínimo que se ve cada paso: con la lectura en caché la respuesta llega casi al instante. */
const STEP_MS = 650;
/** Una pausa con todo marcado antes de abrir el resultado. */
const DONE_MS = 350;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Acompasa una tarea con los pasos del agente. `run` devuelve el resultado de la tarea cuando
 * ella terminó y todos los pasos se vieron; `reset` vuelve al estado inicial tras un error.
 */
export function useAgentProgress() {
  const [step, setStep] = useState<number | null>(null);
  const runId = useRef(0);

  async function run<T>(task: () => Promise<T>): Promise<T> {
    const id = ++runId.current;
    setStep(0);
    const pacing = (async () => {
      for (let i = 1; i < AGENT_STEPS.length; i++) {
        await wait(STEP_MS);
        if (runId.current !== id) return;
        setStep(i);
      }
      await wait(STEP_MS);
    })();
    const [result] = await Promise.all([task(), pacing]);
    if (runId.current === id) {
      setStep(AGENT_STEPS.length);
      await wait(DONE_MS);
    }
    return result;
  }

  function reset() {
    runId.current++;
    setStep(null);
  }

  return { step, run, reset };
}

/** Los pasos del agente: hechos con su marca, el actual con su indicador, los demás tenues. */
export function AgentProgress({ step }: { readonly step: number }) {
  return (
    <ol role="status" aria-live="polite" className="space-y-1.5 text-[12px]">
      {AGENT_STEPS.map((label, i) => {
        const state = i < step ? "hecho" : i === step ? "actual" : "pendiente";
        return (
          <li
            key={label}
            className={`flex items-center gap-2 transition-colors duration-300 ${
              state === "pendiente" ? "text-ink-3" : state === "actual" ? "text-ink" : "text-ink-2"
            }`}
          >
            <span className="inline-flex size-4 shrink-0 items-center justify-center">
              {state === "hecho" ? (
                <CheckIcon className="size-4 text-pay" />
              ) : state === "actual" ? (
                <span className="size-3.5 animate-spin rounded-full border-2 border-brand/25 border-t-brand motion-reduce:animate-none" />
              ) : (
                <span className="size-1.5 rounded-full bg-line" />
              )}
            </span>
            <span className={state === "actual" ? "font-medium" : undefined}>
              {label}
              {state === "actual" ? "…" : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
