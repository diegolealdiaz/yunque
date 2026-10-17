import { CardSkeleton } from "../../_components/states";

/** Reglas en carga: los tres interruptores y las dos columnas del formulario. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Cargando reglas" className="space-y-4">
      <span className="skeleton block h-8 w-36" />
      <div className="grid gap-3 md:grid-cols-3">
        <CardSkeleton lines={1} />
        <CardSkeleton lines={1} />
        <CardSkeleton lines={1} />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <CardSkeleton lines={8} />
        <CardSkeleton lines={10} />
      </div>
    </div>
  );
}
