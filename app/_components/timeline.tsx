import { clock } from "@/src/ui/format";

/**
 * Línea de tiempo de una factura: recibida, leída, verificada, decidida, aprobada,
 * notificada. Cada entrada con hora en la zona de la empresa y quién la hizo.
 */

export type TimelineEntry = {
  readonly id: string;
  /** Instante ISO en UTC. */
  readonly at: string;
  readonly label: string;
  readonly detail?: string | null;
  /** "agente" o el nombre de la persona. */
  readonly actor: string;
};

export function Timeline({ entries }: { readonly entries: readonly TimelineEntry[] }) {
  return (
    <ol className="space-y-2 text-[13px]">
      {entries.map((entry) => (
        <li key={entry.id} className="grid grid-cols-[3rem_1fr] gap-2">
          <time dateTime={entry.at} className="num text-ink-3">
            {clock(entry.at)}
          </time>
          <span>
            <span className="text-ink">{entry.label}</span>
            {entry.detail ? <span className="text-ink-2"> · {entry.detail}</span> : null}
            <span className="block text-[12px] text-ink-3">{entry.actor}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
