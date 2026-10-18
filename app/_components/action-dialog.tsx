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
  icon = null,
  block = false,
}: {
  readonly children: ReactNode;
  /** Texto del botón y título del diálogo. */
  readonly label: string;
  /** La acción principal de la pantalla: una sola por pantalla. */
  readonly primary?: boolean;
  /** Icono antes del texto del botón. */
  readonly icon?: ReactNode;
  /** El botón ocupa todo el ancho que tiene (paneles laterales). */
  readonly block?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        className={`inline-flex items-center justify-center gap-2 px-4 text-[13px] ${
          block ? "h-10 w-full" : "h-9"
        } ${
          primary
            ? "btn-primary"
            : "rounded-[var(--radius-control)] border border-control font-medium text-ink hover:bg-surface-hover"
        }`}
      >
        {icon}
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
