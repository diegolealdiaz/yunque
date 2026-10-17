"use client";

import Image from "next/image";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Visor de documento con citas (docs/interfaz.md §5.2, columna 1, y D11).
 *
 * - El navegador nunca abre el PDF: ve las páginas que el servidor renderizó a PNG.
 * - Las citas se resaltan sobre la imagen cuando se conoce su posición, y siempre sobre el
 *   texto leído debajo.
 * - Seleccionar un campo en otra columna (`EvidenceTarget`) resalta y desplaza su cita.
 * - Nada del documento se interpreta: el texto se pinta como texto, nunca como HTML.
 */

export type PageImage = {
  readonly src: string;
  readonly width: number;
  readonly height: number;
};

export type Highlight = {
  readonly id: string;
  /** Nombre que se lee en pantalla: "Monto", "Cuenta". */
  readonly label: string;
  /** Fragmento literal del documento que respalda el campo. */
  readonly quote: string;
  readonly page: number;
  /** Posición en fracciones de la página (0 a 1), si se conoce. */
  readonly box: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  } | null;
};

type EvidenceState = {
  readonly selected: string | null;
  readonly select: (id: string | null) => void;
};

const EvidenceContext = createContext<EvidenceState>({ selected: null, select: () => undefined });

/** Comparte la cita seleccionada entre el visor y la lista de campos. */
export function EvidenceProvider({ children }: { readonly children: ReactNode }) {
  const [selected, select] = useState<string | null>(null);
  return (
    <EvidenceContext.Provider value={{ selected, select }}>{children}</EvidenceContext.Provider>
  );
}

/** Envuelve un campo leído: al activarlo se resalta su cita en el documento. */
export function EvidenceTarget({
  id,
  children,
}: {
  readonly id: string;
  readonly children: ReactNode;
}) {
  const { selected, select } = useContext(EvidenceContext);
  const active = selected === id;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => select(active ? null : id)}
      className={`w-full rounded-[var(--radius-control)] px-2 py-1 text-left ${active ? "bg-surface-sunken font-medium" : "hover:bg-surface-hover"}`}
    >
      {children}
    </button>
  );
}

type Segment = { readonly text: string; readonly highlight: Highlight | null };

/** Parte el texto en tramos, marcando la primera aparición de cada cita sin solaparse. */
export function segmentText(text: string, highlights: readonly Highlight[]): Segment[] {
  const found = highlights
    .map((h) => ({ h, start: h.quote === "" ? -1 : text.indexOf(h.quote) }))
    .filter((f) => f.start >= 0)
    .sort((a, b) => a.start - b.start);
  const out: Segment[] = [];
  let cursor = 0;
  for (const { h, start } of found) {
    if (start < cursor) continue;
    if (start > cursor) out.push({ text: text.slice(cursor, start), highlight: null });
    out.push({ text: text.slice(start, start + h.quote.length), highlight: h });
    cursor = start + h.quote.length;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), highlight: null });
  return out;
}

export function DocumentViewer({
  pages,
  text,
  highlights,
}: {
  readonly pages: readonly PageImage[];
  /** Texto leído del documento; vacío si es un escaneo sin capa de texto. */
  readonly text: string;
  readonly highlights: readonly Highlight[];
}) {
  const { selected } = useContext(EvidenceContext);
  const marks = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    if (selected)
      marks.current.get(selected)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);

  return (
    <div className="space-y-4">
      {pages.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface px-4 py-6 text-center text-[13px] text-ink-2">
          El mensaje no trae un documento adjunto. Abajo está su texto, tal como llegó.
        </p>
      ) : null}
      {pages.map((page, index) => (
        <figure key={page.src} className="relative overflow-hidden card">
          <Image
            src={page.src}
            width={page.width}
            height={page.height}
            alt={`Página ${String(index + 1)} del documento`}
            unoptimized
            className="block h-auto w-full"
          />
          {highlights
            .filter((h) => h.page === index + 1 && h.box)
            .map((h) => (
              <span
                key={h.id}
                aria-hidden="true"
                className={`absolute rounded-sm border-2 ${selected === h.id ? "border-ink bg-ink/10" : "border-transparent"}`}
                style={
                  h.box
                    ? {
                        left: `${String(h.box.x * 100)}%`,
                        top: `${String(h.box.y * 100)}%`,
                        width: `${String(h.box.w * 100)}%`,
                        height: `${String(h.box.h * 100)}%`,
                      }
                    : undefined
                }
              />
            ))}
        </figure>
      ))}
      <section aria-label="Texto leído del documento">
        <h3 className="mb-1 caps">Texto leído</h3>
        {text === "" ? (
          <p className="text-[13px] text-ink-3">
            El documento es una imagen sin capa de texto; el agente lo leyó de la página.
          </p>
        ) : (
          <p className="max-h-80 overflow-auto rounded-[var(--radius-control)] bg-surface-sunken p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-ink">
            {segmentText(text, highlights).map((segment, i) =>
              segment.highlight ? (
                <mark
                  key={i}
                  ref={(element) => {
                    if (element && segment.highlight)
                      marks.current.set(segment.highlight.id, element);
                  }}
                  title={segment.highlight.label}
                  className={`rounded-sm px-0.5 text-ink ${selected === segment.highlight.id ? "bg-surface outline-2 outline-ink" : "bg-pending-tint"}`}
                >
                  {segment.text}
                </mark>
              ) : (
                <span key={i}>{segment.text}</span>
              ),
            )}
          </p>
        )}
      </section>
    </div>
  );
}
