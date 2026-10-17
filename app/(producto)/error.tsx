"use client";

import { ErrorState } from "../_components/states";

/**
 * Límite de error de las pantallas. Dice qué pasó y qué hacer; nunca muestra el detalle
 * técnico, que puede traer datos del documento.
 */
export default function ScreenError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <ErrorState
      title="No se pudo mostrar esta pantalla"
      cause="Hubo un problema al leer los datos."
      action="Reintenta en unos segundos. Si sigue fallando, revisa la salud del sistema."
      retry={
        <button
          type="button"
          onClick={() => retry()}
          className="h-8 rounded-[var(--radius-control)] border border-control bg-surface px-3 text-[13px] font-medium text-ink"
        >
          Reintentar
        </button>
      }
    />
  );
}
