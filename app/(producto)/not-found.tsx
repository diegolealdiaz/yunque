import { EmptyState } from "../_components/states";

/**
 * Lo que no existe, o no es de esta empresa, responde igual: "no existe". Nunca se distingue
 * una factura ajena de una inexistente.
 */
export default function NotFound() {
  return (
    <EmptyState
      title="No encontramos lo que buscas"
      detail="Puede que el enlace esté mal o que no pertenezca a esta empresa."
      action={{ label: "Volver a pendientes", href: "/pendientes" }}
    />
  );
}
