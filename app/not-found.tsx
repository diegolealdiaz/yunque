import Link from "next/link";
import { connection } from "next/server";

export const metadata = { title: "No encontrada · Yunque" };

/**
 * Una dirección que no existe fuera de la app. Se arma en cada petición, como la portada,
 * para llevar el nonce de la política de contenido; estática, el navegador bloquea sus
 * scripts.
 */
export default async function NotFound() {
  await connection();
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="max-w-md text-center">
        <p className="caps text-brand">Error 404</p>
        <h1 className="mt-2 text-[26px] leading-8 font-bold tracking-[-0.01em] text-ink">
          Esta página no existe
        </h1>
        <p className="mt-3 text-[14px] leading-[22px] text-ink-2">
          Puede que el enlace esté mal escrito o que la página ya no esté.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link href="/" className="inline-flex h-9 items-center btn-primary px-4 text-[13px]">
            Ir a la portada
          </Link>
          <Link
            href="/pendientes"
            className="inline-flex h-9 items-center rounded-[var(--radius-control)] border border-control px-4 text-[13px] font-medium text-ink"
          >
            Abrir la demo
          </Link>
        </div>
      </div>
    </main>
  );
}
