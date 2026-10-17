"use client";

import { useId, useRef, type ReactNode } from "react";

/**
 * Botón que abre una forma de entregar facturas en un diálogo (subir un archivo, recibir por
 * correo): la acción ocupa un botón en el encabezado y no una franja de la pantalla.
 */
export function ActionDialog({
  children,
  label,
  primary = false,
}: {
  readonly children: ReactNode;
  /** Texto del botón y título del diálogo. */
  readonly label: string;
  /** La acción principal de la pantalla: una sola por pantalla. */
  readonly primary?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        className={`h-9 px-4 text-[13px] ${
          primary
            ? "btn-primary"
            : "rounded-[var(--radius-control)] border border-control font-medium text-ink hover:bg-surface-hover"
        }`}
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
        className="m-auto w-full max-w-lg card text-ink backdrop:bg-black/50"
      >
        <div className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <p id={titleId} className="text-[16px] font-semibold">
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
