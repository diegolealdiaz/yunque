import { normalizeText, type ExtractedFields, type Vendor } from "@/src/domain";
import type { PayeeMatch } from "@/src/engine";

/**
 * Resolutor de beneficiario. Empareja lo leído contra la lista de vendors de la empresa:
 * identificador fiscal primero, luego razón social normalizada, luego alias. Un nombre
 * parecido no empareja: devuelve `unknown` con el más cercano para la explicación.
 * Nunca inventa un vendor ni devuelve una cuenta que no esté en la lista.
 */

/**
 * Nombre comparable: normalizado ("Nube Andina S.A.S." → "NUBE ANDINA SAS"). El sufijo
 * societario se conserva: "Nube Andina Ltda" es otra empresa, no una variante de escritura.
 */
export function comparableName(name: string): string {
  return normalizeText(name);
}

/** Identificador fiscal comparable: solo letras y dígitos. */
export function comparableTaxId(taxId: string): string {
  return taxId.replace(/[^A-Za-z0-9]+/g, "").toUpperCase();
}

function bigrams(text: string): Map<string, number> {
  const out = new Map<string, number>();
  const compact = text.replace(/\s+/g, " ");
  for (let i = 0; i < compact.length - 1; i++) {
    const g = compact.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** Similitud de Sørensen–Dice sobre bigramas de caracteres, entre 0 y 1. */
export function similarity(a: string, b: string): number {
  const ga = bigrams(a);
  const gb = bigrams(b);
  if (ga.size === 0 || gb.size === 0) return a === b ? 1 : 0;
  let shared = 0;
  let totalA = 0;
  let totalB = 0;
  for (const n of ga.values()) totalA += n;
  for (const n of gb.values()) totalB += n;
  for (const [g, n] of ga) shared += Math.min(n, gb.get(g) ?? 0);
  return (2 * shared) / (totalA + totalB);
}

/** Por encima de esto, un nombre se considera "parecido" y se nombra en la explicación. */
export const SIMILARITY_THRESHOLD = 0.6;

export type ResolveInput = Pick<ExtractedFields, "payee_name" | "payee_tax_id">;

export function resolvePayee(fields: ResolveInput, vendors: readonly Vendor[]): PayeeMatch {
  const readName = comparableName(fields.payee_name.value);
  const readTaxId =
    fields.payee_tax_id.value === null ? null : comparableTaxId(fields.payee_tax_id.value);

  if (readTaxId !== null && readTaxId.length >= 5) {
    const byTax = vendors.find(
      (v) => v.tax_id !== undefined && comparableTaxId(v.tax_id) === readTaxId,
    );
    if (byTax) return { kind: "matched", vendor: byTax, by: "tax_id" };
  }

  const exact = vendors.find((v) => comparableName(v.name) === readName);
  if (exact) return { kind: "matched", vendor: exact, by: "exact" };

  const byAlias = vendors.find((v) => v.aliases.some((a) => comparableName(a) === readName));
  if (byAlias) return { kind: "matched", vendor: byAlias, by: "alias" };

  let closest: { vendor: Vendor; similarity: number } | null = null;
  for (const vendor of vendors) {
    const candidates = [vendor.name, ...vendor.aliases].map(comparableName);
    const best = Math.max(...candidates.map((c) => similarity(c, readName)));
    if (best >= SIMILARITY_THRESHOLD && (closest === null || best > closest.similarity)) {
      closest = { vendor, similarity: best };
    }
  }
  return { kind: "unknown", closest };
}
