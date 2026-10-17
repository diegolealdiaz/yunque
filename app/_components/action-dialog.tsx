"use client";

import { useId, useRef, type ReactNode } from "react";

/**
 * Botón que abre una forma de entregar facturas en un diálogo (subir un archivo, recibir por
 * correo): la acción ocupa un botón en el encabezado y no una franja de la pantalla.
 */
export function ActionDialog({
  children,
  label,
}: {
  readonly children: ReactNode;
  /** Texto del botón y título del diálogo. */
  readonly label: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        className="h-8 rounded-[var(--radius-control)] border border-control px-3 text-[13px] font-medium text-ink"
      >
        {label}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        // Un clic en el fondo cierra el diálogo, como Esc. El relleno va en el contenido, así
        // un clic dentro del recuadro nunca tiene como destino el diálogo mismo.
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
        className="m-auto w-full max-w-lg rounded-[var(--radius-card)] border border-line bg-surface text-ink backdrop:bg-ink/30"
      >
        <div className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <p id={titleId} className="text-[14px] font-medium">
              {label}
            </p>
            <button
              type="button"
              onClick={() => dialog.current?.close()}
              className="h-8 rounded-[var(--radius-control)] border border-control px-3 text-[13px]"
            >
              Cerrar
            </button>
          </div>
          {children}
        </div>
      </dialog>
    </>
  );
}
