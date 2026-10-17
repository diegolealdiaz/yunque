import { CardSkeleton } from "../../_components/states";

/** Métricas en carga: las seis tarjetas numéricas y los dos paneles. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Cargando métricas" className="space-y-4">
      <span className="skeleton block h-8 w-40" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <CardSkeleton key={i} lines={2} />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <CardSkeleton lines={6} />
        <CardSkeleton lines={6} />
      </div>
    </div>
  );
}
