/**
 * Todo contenido de documento es no confiable. Antes de interpolarlo en una explicación,
 * una notificación o un mensaje de chat, se neutraliza: sin etiquetas, sin markdown que se
 * active, sin enlaces ni dominios que un cliente convierta en link, sin caracteres de
 * control ni invisibles, con longitud acotada y sin cortar un carácter a la mitad.
 * La interfaz además lo renderiza siempre como texto, nunca como HTML.
 */

const MAX_LENGTH = 300;

const REPLACEMENTS: readonly [RegExp, string][] = [
  [/\s+/g, " "], // espacios, saltos y separadores de línea o párrafo
  [/\p{Cc}/gu, ""], // caracteres de control
  [/\p{Cf}/gu, ""], // invisibles de formato: ancho cero, marcas de dirección, BOM
  [/</g, "‹"],
  [/>/g, "›"],
  [/`/g, "'"],
  [/\*/g, "∗"],
  [/_/g, "＿"],
  [/\[/g, "［"],
  [/\]/g, "］"],
  [/(https?|ftp|file|javascript|data):\/\//gi, "$1(:)//"], // enlace desactivado, legible
  [/(\w)@(\w)/g, "$1＠$2"], // ni correo clicable
  // Dominio sin esquema ("evil.example/x", "www.evil.example"): el punto deja de ser punto.
  [/\b([a-z0-9-]+)\.(?=[a-z]{2,}(?:[/:?#\s]|$))/gi, "$1·"],
];

/** Texto del documento listo para ir dentro de una frase. */
export function sanitizeDocumentText(text: string): string {
  let out = text.normalize("NFKC");
  for (const [pattern, replacement] of REPLACEMENTS) out = out.replace(pattern, replacement);
  out = out.trim();
  const chars = Array.from(out);
  if (chars.length > MAX_LENGTH) out = `${chars.slice(0, MAX_LENGTH - 1).join("")}…`;
  return out;
}

/** Cita entre comillas angulares, para distinguir lo que dice el documento de lo que decimos. */
export function quote(text: string): string {
  return `«${sanitizeDocumentText(text)}»`;
}

/**
 * Verdadero si el texto mezcla alfabetos (latino con cirílico o griego): la forma clásica
 * de disfrazar un nombre con homóglifos. La pantalla lo marca; no cambia el veredicto.
 */
export function mixesScripts(text: string): boolean {
  const latin = /\p{Script=Latin}/u.test(text);
  const confusable = /[\p{Script=Cyrillic}\p{Script=Greek}]/u.test(text);
  return latin && confusable;
}
