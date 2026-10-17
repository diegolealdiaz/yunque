import { PageHeader } from "../../_components/page-header";
import { EmptyState } from "../../_components/states";

export const metadata = { title: "Pendientes · Yunque" };

/** Pantalla en construcción: se arma en el paso 20 del plan. */
export default function Page() {
  return (
    <>
      <PageHeader title="Pendientes" />
      <EmptyState
        title="Esta pantalla se construye en el paso 20"
        detail="Mientras tanto, la página de componentes muestra las piezas con datos de muestra."
        action={{ label: "Ver componentes", href: "/componentes" }}
      />
    </>
  );
}
