import { CardSkeleton } from "../../../_components/states";

/** Detalle en carga: encabezado, la tarjeta «Por qué» y las tres columnas. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Cargando la decisión" className="space-y-6">
      <div className="flex items-end justify-between gap-6">
        <div className="space-y-2">
          <span className="skeleton block h-3 w-24" />
          <span className="skeleton block h-8 w-72" />
        </div>
        <span className="skeleton block h-8 w-56" />
      </div>
      <CardSkeleton lines={3} />
      <div className="grid gap-8 lg:grid-cols-2 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_19rem]">
        <span className="skeleton block h-96" />
        <CardSkeleton lines={8} />
        <CardSkeleton lines={5} />
      </div>
    </div>
  );
}
