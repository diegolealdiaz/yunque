import { TableSkeleton } from "../../_components/states";

/** Bitácora en carga: título, filtros y la tabla de eventos. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Cargando bitácora" className="space-y-4">
      <span className="skeleton block h-8 w-40" />
      <span className="skeleton block h-9 w-full max-w-xl" />
      <TableSkeleton rows={12} columns={5} />
    </div>
  );
}
