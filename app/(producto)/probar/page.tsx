import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { GALLERY, GALLERY_PREVIEW_DIR } from "@/src/dataset/gallery";
import { datasetReceiptKey, loadBatchCases } from "@/src/dataset/demo-seed";
import { loadGalleryInvoices, loadInvoiceBuilder } from "@/src/usecases";

import { PageHeader } from "../../_components/page-header";
import { VerdictPill } from "../../_components/verdict-pill";
import { appContext } from "../../_data/context";
import { UploadPanel } from "../facturas/upload-panel";

import { InvoiceBuilder } from "./invoice-builder";
import { TryCase } from "./try-case";

export const metadata = { title: "Probar el agente · Yunque" };

/** Tamaño de las miniaturas generadas: una página A4 a la resolución de la ingesta. */
const PREVIEW = { width: 910, height: 1287 } as const;

/**
 * Probar el agente (docs/interfaz.md §5.8): una galería de casos del lote para elegir de a
 * uno y ver qué decide el agente, y abajo, la subida de una factura propia. Cada tarjeta dice
 * qué trae la factura, no el resultado; la que ya se probó lleva a su detalle. Solo existe
 * en la demo.
 */
export default async function ProbarPage() {
  const { config, db, organization } = await appContext();
  if (!config.demo.enabled) notFound();
  const batch = await loadBatchCases();
  const cases = GALLERY.flatMap((g) => {
    const found = batch.find((c) => c.id === g.id);
    return found ? [{ ...g, format: found.format, receiptKey: datasetReceiptKey(found) }] : [];
  });
  const done = await loadGalleryInvoices(
    db,
    organization.id,
    cases.map((c) => c.receiptKey),
  );
  const tried = cases.filter((c) => done.has(c.receiptKey)).length;
  const vendors = await loadInvoiceBuilder(db, organization.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Probar el agente"
        subtitle="Elige una factura y mira qué decide el agente, en vivo y con tus reglas."
        meta={
          <span className="font-mono text-[12px]">
            {tried} de {cases.length} probadas
          </span>
        }
      />

      <ul data-tour="galeria" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cases.map((c) => {
          const invoice = done.get(c.receiptKey);
          return (
            <li key={c.id} className="relative flex flex-col overflow-hidden card">
              <div className="relative h-48 overflow-hidden border-b border-line bg-white">
                <Image
                  src={`/${GALLERY_PREVIEW_DIR}/${c.id}.png`}
                  width={PREVIEW.width}
                  height={PREVIEW.height}
                  alt={`Vista de la factura: ${c.hint}`}
                  unoptimized
                  className="block h-auto w-full"
                />
                {c.format === "email" ? (
                  <span className="absolute top-2.5 left-2.5 rounded-full bg-ink/80 px-2.5 py-1 text-[11px] font-medium text-surface">
                    Llega por correo, con un mensaje
                  </span>
                ) : null}
              </div>
              <div className="flex flex-1 flex-col gap-1 p-4">
                <p className="text-[15px] leading-snug font-semibold text-ink">{c.title}</p>
                <p className="text-[12px] text-ink-3">{c.hint}</p>
                <div className="mt-auto pt-4">
                  {invoice ? (
                    <div className="flex items-center justify-between gap-3">
                      <VerdictPill verdict={invoice.verdict ?? "en_proceso"} />
                      <Link
                        href={`/facturas/${invoice.invoiceId}`}
                        className="text-[13px] font-medium text-ink underline-offset-4 hover:underline"
                      >
                        Ver por qué →
                      </Link>
                    </div>
                  ) : (
                    <TryCase caso={c.id} />
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <section
        aria-labelledby="armada"
        data-tour="armar"
        className="grid gap-5 card p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]"
      >
        <div className="space-y-2">
          <h2 id="armada" className="text-[17px] font-semibold text-ink">
            Arma tu propia factura
          </h2>
          <p className="text-[13px] leading-relaxed text-ink-2">
            Elige el proveedor, el monto, la cuenta y lo que dice la factura. Yunque la arma con el
            formato de su país y el agente la lee y la decide como a cualquier otra.
          </p>
          <p className="text-[13px] leading-relaxed text-ink-2">
            Prueba a engañarlo: cambia la cuenta, infla el monto o escribe una instrucción, incluso
            en texto invisible. Con los datos que cuadran, la paga sola.
          </p>
        </div>
        <InvoiceBuilder vendors={vendors} />
      </section>

      <section
        aria-labelledby="propia"
        data-tour="subir"
        className="grid gap-5 card p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]"
      >
        <div className="space-y-2">
          <h2 id="propia" className="text-[17px] font-semibold text-ink">
            O sube la tuya
          </h2>
          <p className="text-[13px] leading-relaxed text-ink-2">
            Una factura en PDF o foto. El agente la lee igual que las de ejemplo y te muestra cada
            campo con el lugar del documento de donde lo sacó.
          </p>
          <p className="text-[13px] leading-relaxed text-ink-2">
            Ten en cuenta: tu proveedor no está registrado en la empresa de ejemplo, así que el
            agente no la paga sola. La pasa a una persona con el porqué, que es justo lo que debe
            hacer con alguien que no conoce.
          </p>
        </div>
        <UploadPanel maxBytes={config.demo.maxUploadBytes} />
      </section>
    </div>
  );
}
