"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";

/**
 * Tabla densa de herramienta (docs/interfaz.md §6): filas de 36 px, texto de 13 px, números
 * tabulares. Las celdas llegan ya renderizadas, así la pantalla que la usa puede ser un
 * componente de servidor; aquí solo vive la navegación.
 *
 * Teclado (docs/interfaz.md §4): `J` o flecha abajo baja, `K` o flecha arriba sube, `Inicio`
 * y `Fin` saltan, `Enter` abre la fila. Una sola fila es tabulable a la vez (foco itinerante),
 * así `Tab` sale de la tabla en vez de recorrer cada fila.
 */

export type Column = {
  /** Título de la columna. Siempre presente: lo leen los lectores de pantalla. */
  readonly header: string;
  /** Oculta el título a la vista (columnas de icono o de acción), no a los lectores. */
  readonly hideHeader?: boolean;
  readonly align?: "left" | "right";
  /** Ancho CSS opcional: "6rem", "20%". */
  readonly width?: string;
};

export type Row = {
  readonly key: string;
  /** A dónde lleva abrir la fila; sin él, la fila no se abre. */
  readonly href?: string;
  readonly cells: readonly ReactNode[];
};

export function DataTable({
  caption,
  columns,
  rows,
  empty = null,
}: {
  /** Nombre de la tabla para lectores de pantalla. */
  readonly caption: string;
  readonly columns: readonly Column[];
  readonly rows: readonly Row[];
  /** Lo que se muestra si no hay filas: un `EmptyState`. */
  readonly empty?: ReactNode;
}) {
  const router = useRouter();
  const [active, setActive] = useState(0);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);

  if (rows.length === 0 && empty) return <>{empty}</>;
  // Si un filtro dejó menos filas que el índice activo, la última sigue siendo tabulable.
  const current = Math.min(active, rows.length - 1);

  const focusRow = (index: number) => {
    const next = Math.max(0, Math.min(rows.length - 1, index));
    setActive(next);
    rowRefs.current[next]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, index: number) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    switch (event.key) {
      case "j":
      case "ArrowDown":
        event.preventDefault();
        focusRow(index + 1);
        break;
      case "k":
      case "ArrowUp":
        event.preventDefault();
        focusRow(index - 1);
        break;
      case "Home":
        event.preventDefault();
        focusRow(0);
        break;
      case "End":
        event.preventDefault();
        focusRow(rows.length - 1);
        break;
      case "Enter": {
        const href = rows[index]?.href;
        if (href) router.push(href);
        break;
      }
    }
  };

  return (
    // En pantallas angostas la tabla se desplaza; en escritorio no recorta el detalle de los chips.
    <div className="rounded-[var(--radius-card)] border border-line bg-surface max-md:overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line text-left">
            {columns.map((column, c) => (
              <th
                key={c}
                scope="col"
                style={column.width ? { width: column.width } : undefined}
                className={`h-8 px-3 text-[12px] font-medium text-ink-2 ${column.align === "right" ? "text-right" : ""}`}
              >
                <span className={column.hideHeader ? "sr-only" : undefined}>{column.header}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={row.key}
              ref={(element) => {
                rowRefs.current[index] = element;
              }}
              tabIndex={index === current ? 0 : -1}
              onFocus={() => setActive(index)}
              onKeyDown={(event) => onKeyDown(event, index)}
              onClick={(event) => {
                // Un clic en un control de la fila (enlace, botón) hace lo suyo, no abre la fila.
                if (
                  row.href &&
                  !(event.target instanceof Element && event.target.closest("a,button"))
                ) {
                  router.push(row.href);
                }
              }}
              className={`h-[var(--row-height)] border-b border-line last:border-b-0 hover:bg-surface-hover focus-visible:bg-surface-hover ${row.href ? "cursor-pointer" : ""}`}
            >
              {row.cells.map((cell, c) => (
                <td
                  key={c}
                  className={`px-3 align-middle whitespace-nowrap text-ink ${columns[c]?.align === "right" ? "num text-right" : ""}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
