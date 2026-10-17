import { TableSkeleton } from "../_components/states";

/** Mientras una pantalla carga se ve el esqueleto de su tabla, no una rueda. */
export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="skeleton h-7 w-48" />
      <TableSkeleton />
    </div>
  );
}
