"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";

/**
 * Tabla densa de herramienta (docs/interfaz.md §6): filas de 36 px, texto de 13 px, números
 * tabulares. Las celdas llegan ya renderizadas, así la pantalla que la usa puede ser un
 * componente de servidor; aquí solo vive la navegación.
 *
 * Nunca se desplaza de lado en escritorio: cada columna dice desde qué ancho aparece
 * (`from`), así las secundarias (canal, actualizada) se ocultan antes de que falte espacio y
 * la columna flexible recorta su texto. En el teléfono la tabla se vuelve una lista de
 * tarjetas: cada columna dice qué lugar ocupa en la tarjeta (`card`).
 *
 * Con `fill`, en escritorio la tabla ocupa el alto que le queda a la pantalla y se desplaza
 * por dentro con el encabezado fijo: filtros y acciones siguen a la vista sin mover la página.
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
  /** Desde qué ancho de pantalla se muestra la columna; sin él, siempre. */
  readonly from?: "lg" | "xl" | "2xl" | "3xl";
  /** Columna flexible: ocupa lo que sobra y recorta su texto con puntos suspensivos. */
  readonly flexible?: boolean;
  /**
   * Lugar en la tarjeta del teléfono: `title` arriba a la izquierda, `aside` arriba a la
   * derecha (el monto), `line` en la línea de abajo (por defecto), `hidden` no aparece.
   */
  readonly card?: "title" | "aside" | "line" | "hidden";
};

export type Row = {
  readonly key: string;
  /** A dónde lleva abrir la fila; sin él, la fila no se abre. */
  readonly href?: string;
  readonly cells: readonly ReactNode[];
  /** Nombre de la fila para lectores de pantalla en la tarjeta: «Abrir YQ-2026-10-0021». */
  readonly label?: string;
};

export function DataTable({
  caption,
  columns,
  rows,
  empty = null,
  fill = false,
}: {
  /** Nombre de la tabla para lectores de pantalla. */
  readonly caption: string;
  readonly columns: readonly Column[];
  readonly rows: readonly Row[];
  /** Lo que se muestra si no hay filas: un `EmptyState`. */
  readonly empty?: ReactNode;
  /** Ocupa el alto restante de la pantalla y se desplaza por dentro (escritorio). */
  readonly fill?: boolean;
}) {
  const router = useRouter();
  const place = (c: number) => columns[c]?.card ?? "line";
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

  const visibility = (column: Column | undefined) =>
    column?.from === "lg"
      ? "hidden lg:table-cell"
      : column?.from === "xl"
        ? "hidden xl:table-cell"
        : column?.from === "2xl"
          ? "hidden 2xl:table-cell"
          : column?.from === "3xl"
            ? "hidden min-[1800px]:table-cell"
            : "";

  return (
    <>
      {/* Teléfono: una tarjeta por fila. Toda la tarjeta abre la fila; los enlaces de las celdas quedan encima. */}
      <ul aria-label={caption} className="space-y-2 md:hidden">
        {rows.map((row) => {
          const cells = row.cells.map((cell, c) => ({ cell, c }));
          const title = cells.filter(({ c }) => place(c) === "title");
          const aside = cells.filter(({ c }) => place(c) === "aside");
          const line = cells.filter(({ c }) => place(c) === "line");
          return (
            <li
              key={row.key}
              className="relative rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 text-[13px] has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-ink"
            >
              {row.href ? (
                <Link
                  href={row.href}
                  aria-label={row.label ? `Abrir ${row.label}` : "Abrir"}
                  className="absolute inset-0 rounded-[var(--radius-card)] outline-none"
                />
              ) : null}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 font-medium text-ink">
                  {title.map(({ cell, c }) => (
                    <div key={c} className="truncate">
                      {cell}
                    </div>
                  ))}
                </div>
                {aside.map(({ cell, c }) => (
                  <div key={c} className="num shrink-0 text-right text-ink">
                    {cell}
                  </div>
                ))}
              </div>
              {line.length > 0 ? (
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-ink-2 [&_a]:relative [&_a]:z-10">
                  {line.map(({ cell, c }) => (
                    <span key={c} className="min-w-0">
                      {cell}
                    </span>
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {/*
        Desde tableta, la tabla. Si algo no cupiera antes del escritorio, se desplaza dentro de
        su tarjeta. En escritorio, sin `fill`, no recorta el detalle de los chips; con `fill`,
        se desplaza por dentro bajo el encabezado fijo.
      */}
      <div
        className={`rounded-[var(--radius-card)] border border-line bg-surface max-md:hidden max-lg:overflow-x-auto ${
          fill ? "lg:min-h-0 lg:flex-1 lg:overflow-auto" : ""
        }`}
      >
        <table className="w-full table-fixed border-collapse text-[13px]">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="sticky top-0 z-10 border-b border-line bg-surface text-left shadow-[0_1px_0_var(--line)]">
              {columns.map((column, c) => (
                <th
                  key={c}
                  scope="col"
                  style={column.width ? { width: column.width } : undefined}
                  className={`h-8 px-3 text-[12px] font-medium text-ink-2 ${column.align === "right" ? "text-right" : ""} ${visibility(column)}`}
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
                    className={`px-3 align-middle whitespace-nowrap text-ink ${columns[c]?.align === "right" ? "num text-right" : ""} ${columns[c]?.flexible ? "truncate" : ""} ${visibility(columns[c])}`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
