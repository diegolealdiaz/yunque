import facturaCo from "@/data/dataset/plantillas/factura_co.json";
import facturaEu from "@/data/dataset/plantillas/factura_eu.json";
import invoiceEn from "@/data/dataset/plantillas/invoice_en.json";
import notaCobroMx from "@/data/dataset/plantillas/nota_cobro_mx.json";

import { TemplateSchema, type DocumentTemplate } from "./schema";

/**
 * Las plantillas de factura del dataset, importadas como módulos: así viajan en el bundle de
 * la ruta que las usa («Arma tu propia factura») sin leerlas del disco en producción, donde
 * no se incluyen. Se validan con el mismo esquema que usa el generador.
 */
const TEMPLATES: ReadonlyMap<string, DocumentTemplate> = new Map(
  [facturaCo, facturaEu, invoiceEn, notaCobroMx].map((raw) => {
    const template = TemplateSchema.parse(raw);
    return [template.id, template];
  }),
);

export function invoiceTemplate(id: string): DocumentTemplate {
  const template = TEMPLATES.get(id);
  if (!template) throw new Error(`Plantilla ${id} no incluida`);
  return template;
}
