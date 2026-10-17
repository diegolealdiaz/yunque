import { redirect } from "next/navigation";

/** La bandeja de pendientes es la pantalla principal (docs/interfaz.md, principio 1). */
export default function Home() {
  redirect("/pendientes");
}
