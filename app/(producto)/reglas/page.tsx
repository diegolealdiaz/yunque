import { PageHeader } from "../../_components/page-header";
import { EmptyState } from "../../_components/states";

export const metadata = { title: "Reglas · Yunque" };

/** Pantalla en construcción: se arma en el paso 24 del plan. */
export default function Page() {
  return (
    <>
      <PageHeader title="Reglas" />
      <EmptyState
        title="Esta pantalla se construye en el paso 24"
        detail="Mientras tanto, la página de componentes muestra las piezas con datos de muestra."
        action={{ label: "Ver componentes", href: "/componentes" }}
      />
    </>
  );
}
