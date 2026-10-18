import type { Suspicion } from "@/src/domain";

/**
 * Detector de instrucciones embebidas. Es una señal, no la defensa: la defensa es que el
 * modelo nunca decide. Busca patrones en el texto del documento y del canal (correo o chat):
 * órdenes al sistema, aprobaciones afirmadas, pedidos de saltar la revisión o de pagar a
 * una cuenta nueva, y marcadores que imitan los delimitadores del prompt. También confirma
 * el token canario si aparece en la salida del modelo.
 *
 * Criterios de diseño:
 * - Una señal frena la factura, así que cada patrón exige contexto de orden o de aprobación
 *   afirmada, no una palabra suelta: "Pagar a esta cuenta", "aprobada por la DIAN",
 *   "Operating System: Windows" o "Nota al agente de aduanas" no disparan.
 * - Los huecos entre palabras admiten saltos de línea (la capa de texto del PDF los inserta)
 *   y están acotados, así ninguna expresión retrocede sin límite.
 * - Español (incluido el voseo), inglés y portugués.
 */

/** Inicio y fin de palabra que entienden letras con tilde (`\b` solo conoce ASCII). */
const L = String.raw`(?<!\p{L})`;
const R = String.raw`(?!\p{L})`;
/** Hueco acotado entre dos partes de una frase, sin cruzar un punto. */
const GAP = (n: number) => String.raw`[^.]{0,${String(n)}}?`;

const AUTHORITY = String.raw`(?:la\s+|el\s+|the\s+|a\s+)?(?:DIAN|SAT|AFIP|ARCA|SII|IRS|Receita|Finanzamt|SUNAT)${R}`;

const SOURCES: readonly string[] = [
  // Ignorar u omitir reglas, validaciones o instrucciones.
  String.raw`${L}(?:ignor[aá]|ignorar|ignore|omit[ea]|omitir|skip|disregard|override|desconsidere|desconsiderar)${R}${GAP(60)}${L}(?:reglas?|rules?|regras?|validaci[oó]n(?:es)?|valida[cç][aã]o|valida[cç][oõ]es|comprobaci[oó]n(?:es)?|checks?|instrucciones|instructions|instru[cç][oõ]es|pol[ií]tica|policy)${R}`,
  // Mensaje dirigido al sistema o al asistente (no al agente de aduanas ni al comercial).
  String.raw`${L}(?:nota|instrucci[oó]n|mensaje|note|instruction|instru[cç][aã]o)(?:es|s)?\s+(?:para|al|a|to|for)\s+(?:el\s+|la\s+|the\s+|o\s+)?(?:sistema|asistente|agente|modelo|system|assistant|agent|model|ai|ia)${R}(?!\s+(?:de\s+aduanas?|aduanal|comercial|administrativ\p{L}*|de\s+ventas|de\s+viajes|inmobiliari\p{L}*|de\s+seguros|of\s+record|sales))`,
  // Marcar la decisión o el pago como aprobado o pagado.
  String.raw`${L}(?:marc[aá]|marcar|marque|mark|set|classify|clasific[aá])${R}${GAP(30)}${L}(?:la\s+decisi[oó]n|el\s+veredicto|esta\s+factura|este\s+pago|the\s+(?:decision|verdict|invoice|payment)|this\s+(?:invoice|payment)|a\s+decis[aã]o)${R}${GAP(20)}${L}(?:como|as)\s+(?:pagar|pagad[oa]|aprobad[oa]|aprovad[oa]|approved|paid|pay)${R}`,
  // Aprobar sin revisión.
  String.raw`${L}(?:aprueb[ae]|aprob[aá]|aprobar|approve|autoriz[ae]|autorizar|authorize|aprove|aprovar)${R}${GAP(40)}${L}(?:sin\s+revisar|sin\s+revisi[oó]n|sin\s+verificar|without\s+(?:review|checking|verification)|sem\s+revis[aã]o|sem\s+revisar)${R}`,
  // Aprobación afirmada por alguien ("ya aprobado por el CFO"), salvo una autoridad fiscal.
  String.raw`${L}(?:ya|already|j[aá])\s+(?:fue\s+|est[aá]\s+|was\s+|has\s+been\s+|is\s+|foi\s+)?(?:aprobad[oa]|verificad[oa]|autorizad[oa]|approved|verified|authorized|aprovad[oa])\s+(?:por|by|pel[oa])\s+(?!${AUTHORITY})`,
  String.raw`${L}(?:aprobad[oa]|autorizad[oa]|approved|authorized|aprovad[oa])\s+(?:por|by|pel[oa])\s+(?:el\s+|la\s+|the\s+|our\s+|nuestro\s+|nuestra\s+|o\s+)?(?:CFO|CEO|COO|director\p{L}*|gerente|finanzas|finance|tesorer\p{L}*|treasur\p{L}*|controller|contralor\p{L}*|financeiro)${R}`,
  String.raw`${L}pre-?(?:aprobad[oa]|approved|aprovad[oa])${R}`,
  // Saltarse la revisión o el flujo.
  String.raw`${L}(?:sin\s+revisar|sin\s+revisi[oó]n|no\s+hace\s+falta\s+(?:pasar\s+por|revisar)|saltar?\s+(?:el|la)\s+(?:flujo|revisi[oó]n)|skip\s+(?:the\s+)?(?:review|approval)|no\s+need\s+to\s+review|sem\s+revis[aã]o|pule\s+a\s+revis[aã]o)${R}`,
  // Pagar a una cuenta nueva u otra cuenta.
  String.raw`${L}(?:transfiere|transfer[ií]|transferir|paga|pag[aá]|pagar|pague|pay|transfer|wire|dep[oó]sita|deposit[aá]|transfira)${R}${GAP(40)}${L}(?:a\s+(?:la\s+)?nueva\s+cuenta|a\s+otra\s+cuenta|cuenta\s+nueva|to\s+(?:the|our|a)\s+new\s+account|to\s+another\s+account|new\s+account|nova\s+conta|outra\s+conta)${R}`,
  // Prefijos de rol al inicio de línea ("System:", "AI:"); "Operating System:" no cuenta.
  String.raw`^[ \t]*(?:system|ai|sistema)[ \t]*:`,
  String.raw`<\/?(?:system|instructions?|prompt)>|\[(?:system|inst)\]`,
  // Marcadores que imitan los delimitadores del prompt.
  String.raw`<<<(?!<)\s*(?:FIN\s+DEL|DOCUMENTO|MENSAJE|END|DOCUMENT)`,
];

const PATTERNS: readonly { readonly pattern: RegExp; readonly kind: Suspicion["kind"] }[] =
  SOURCES.map((source) => ({ pattern: new RegExp(source, "imu"), kind: "instruction_to_agent" }));

/** Longitud máxima de texto que se examina; un documento real cabe holgado. */
export const MAX_DETECT_CHARS = 200_000;

/** Fragmento alrededor de la coincidencia, acotado, para la evidencia. */
function excerpt(text: string, index: number, length: number): string {
  let start = Math.max(0, index - 40);
  let end = Math.min(text.length, index + length + 60);
  // Se corta en palabras completas: la cita se le muestra al cliente tal cual.
  for (let n = 0; n < WORD_SLACK && start > 0 && !/\s/.test(text.charAt(start - 1)); n++) start--;
  for (let n = 0; n < WORD_SLACK && end < text.length && !/\s/.test(text.charAt(end)); n++) end++;
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

/** Cuánto se extiende una cita, como mucho, para no cortar una palabra. */
const WORD_SLACK = 30;

/** Señales en un texto no confiable. Devuelve a lo sumo una por patrón. */
export function detectInstructions(input: string): Suspicion[] {
  const text = input.slice(0, MAX_DETECT_CHARS);
  const out: Suspicion[] = [];
  for (const { pattern, kind } of PATTERNS) {
    const match = pattern.exec(text);
    if (match) out.push({ kind, quote: excerpt(text, match.index, match[0].length) });
  }
  return out;
}

/** Señal de canario: el token secreto del prompt apareció en la salida del modelo. */
export function detectCanary(rawOutput: string, canary: string): Suspicion | null {
  if (canary.length < 8) return null;
  const index = rawOutput.indexOf(canary);
  if (index < 0) return null;
  return { kind: "canary", quote: excerpt(rawOutput, index, canary.length) };
}

/** Señales del documento y del canal, sin repetir la misma clase de hallazgo. */
export function detectAll(input: { document: string; channel: string | null }): Suspicion[] {
  const seen = new Set<string>();
  const out: Suspicion[] = [];
  for (const s of [
    ...detectInstructions(input.document),
    ...(input.channel ? detectInstructions(input.channel) : []),
  ]) {
    const key = `${s.kind}|${s.quote}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(s);
    }
  }
  return out;
}
