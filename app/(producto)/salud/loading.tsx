import { CardSkeleton } from "../../_components/states";

/** Salud en carga: el estado general y sus componentes. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Cargando salud" className="max-w-3xl space-y-4">
      <span className="skeleton block h-8 w-32" />
      <CardSkeleton lines={5} />
    </div>
  );
}
