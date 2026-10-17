import { TableSkeleton } from "../../_components/states";

/** Facturas en carga: título, filtros por veredicto y la tabla. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Cargando facturas" className="space-y-4">
      <div className="flex items-end justify-between">
        <span className="skeleton block h-8 w-40" />
        <span className="skeleton block h-9 w-56" />
      </div>
      <div className="flex gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <span key={i} className="skeleton block h-8 w-24 rounded-full" />
        ))}
      </div>
      <TableSkeleton rows={10} columns={6} />
    </div>
  );
}
