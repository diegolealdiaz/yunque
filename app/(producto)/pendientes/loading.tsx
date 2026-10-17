import { TableSkeleton } from "../../_components/states";

/** Pendientes en carga: la cifra principal con su desglose y la tabla de escaladas. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Cargando pendientes" className="space-y-8">
      <div className="flex flex-col gap-6 border-b border-line pb-7 md:flex-row md:items-end md:gap-14">
        <div className="space-y-3">
          <span className="skeleton block h-3 w-40" />
          <span className="skeleton block h-16 w-64" />
        </div>
        <div className="w-full space-y-4 md:max-w-md">
          <span className="skeleton block h-3 w-full" />
          <span className="skeleton block h-3 w-full" />
        </div>
      </div>
      <TableSkeleton rows={4} columns={5} />
    </div>
  );
}
