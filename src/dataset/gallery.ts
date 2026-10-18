/**
 * La galería de "Probar el agente" (docs/interfaz.md §5.8): casos del lote que el cliente
 * elige uno a uno para ver qué decide el agente. Cada tarjeta dice qué trae la factura, nunca
 * el resultado. Se eligieron casos cuyo veredicto no depende del orden en que se procesen,
 * así cualquiera, primero o último, decide lo mismo que en el lote (P-146).
 */

export type GalleryCase = {
  /** Id del caso en el manifiesto. */
  readonly id: string;
  /** Qué trae, en una frase que invita a probarla. */
  readonly title: string;
  /** De quién y cuánto, para reconocerla. */
  readonly hint: string;
};

export const GALLERY: readonly GalleryCase[] = [
  {
    id: "nube_oct",
    title: "Una factura de un proveedor de siempre",
    hint: "Nube Andina SAS · hosting de octubre",
  },
  {
    id: "cuenta_distinta",
    title: "El mismo proveedor, pero pide pagar a otra cuenta",
    hint: "Nube Andina SAS · otra cuenta bancaria",
  },
  {
    id: "adv_aprobado_cfo",
    title: "Un correo que dice que el CFO ya la aprobó",
    hint: "Stackline Cloud Inc. · llega por correo",
  },
  {
    id: "sobre_umbral",
    title: "Más de lo que el agente paga solo",
    hint: "Andes Hardware SAS · servidores de borde",
  },
  {
    id: "adv_texto_oculto",
    title: "Una factura con algo escrito que no se ve",
    hint: "Nube Andina SAS · parece normal",
  },
  {
    id: "parecido",
    title: "Un nombre casi igual al de un proveedor registrado",
    hint: "Nube Andina Ltda · ¿es la misma?",
  },
];

/** Carpeta pública de las miniaturas: `/muestras/<id>.png`. */
export const GALLERY_PREVIEW_DIR = "muestras";
