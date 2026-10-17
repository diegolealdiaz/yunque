import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { canonicalJson, sha256Hex } from "@/src/domain";
import {
  CANARY_PATTERN,
  PROMPT_VERSION,
  type ModelClient,
  type ModelRequest,
} from "@/src/extraction";

/**
 * Fixtures del Lector: respuestas reales del modelo grabadas en disco, para que la
 * evaluación y CI corran sin red y siempre igual.
 *
 * - La llave es el hash de lo que se le pidió al modelo: versión de prompt, modelo y cada
 *   parte del mensaje (texto tal cual, imágenes por su hash). El mensaje de sistema no
 *   entra porque lleva el canario, que cambia en cada proceso.
 * - Al grabar, el canario de la sesión se reemplaza por un marcador; al reproducir, el
 *   marcador vuelve a ser el canario vigente. Así una inyección que filtró el canario en
 *   vivo se sigue detectando al reproducir.
 * - Una petición sin fixture no se inventa: queda anotada como faltante y la evaluación
 *   falla (P-65).
 */

export const FIXTURES_DIR = path.join(process.cwd(), "tests", "fixtures", "lector");
const CANARY_MARK = "<<CANARIO>>";

const FixtureSchema = z.strictObject({
  model: z.string().min(1),
  prompt_version: z.string().min(1),
  text: z.string(),
  input_tokens: z.number().int().min(0).nullable(),
  output_tokens: z.number().int().min(0).nullable(),
  latency_ms: z.number().int().min(0),
});
export type Fixture = z.infer<typeof FixtureSchema>;

/** Llave de una petición al modelo, estable entre procesos. */
export function fixtureKey(request: ModelRequest): string {
  return sha256Hex(
    canonicalJson({
      prompt_version: PROMPT_VERSION,
      model: request.model,
      parts: request.parts.map((p) =>
        p.type === "text" ? p.text : `imagen:${p.mediaType}:${sha256Hex(p.bytes)}`,
      ),
    }),
  );
}

function canaryOf(request: ModelRequest): string | null {
  return request.system.match(CANARY_PATTERN)?.[0] ?? null;
}

/** Fixtures de una versión de prompt en un directorio: un archivo JSON por llave. */
export class FixtureStore {
  constructor(private readonly root: string = FIXTURES_DIR) {}

  private dir(): string {
    return path.join(this.root, PROMPT_VERSION);
  }

  private file(key: string): string {
    return path.join(this.dir(), `${key}.json`);
  }

  async get(key: string): Promise<Fixture | null> {
    let text: string;
    try {
      text = await readFile(this.file(key), "utf8");
    } catch {
      return null;
    }
    return FixtureSchema.parse(JSON.parse(text));
  }

  async put(key: string, fixture: Fixture): Promise<void> {
    await mkdir(this.dir(), { recursive: true });
    await writeFile(this.file(key), `${JSON.stringify(FixtureSchema.parse(fixture), null, 2)}\n`);
  }

  /** Cuántas fixtures hay grabadas para la versión de prompt vigente. */
  async count(): Promise<number> {
    try {
      return (await readdir(this.dir())).filter((n) => n.endsWith(".json")).length;
    } catch {
      return 0;
    }
  }
}

/** Petición sin fixture: la evaluación la reporta y falla. */
export class MissingFixtureError extends Error {
  constructor(readonly key: string) {
    super(`No hay fixture para la petición ${key.slice(0, 12)}`);
    this.name = "MissingFixtureError";
  }
}

/** Cliente que reproduce fixtures. Las faltantes quedan en `missing`. */
export function fixtureClient(store: FixtureStore): ModelClient & { readonly missing: string[] } {
  const missing: string[] = [];
  return {
    missing,
    async complete(request) {
      const key = fixtureKey(request);
      const fixture = await store.get(key);
      if (!fixture) {
        missing.push(key);
        throw new MissingFixtureError(key);
      }
      const canary = canaryOf(request);
      return {
        text: canary === null ? fixture.text : fixture.text.replaceAll(CANARY_MARK, canary),
        inputTokens: fixture.input_tokens,
        outputTokens: fixture.output_tokens,
      };
    },
  };
}

/** Cliente que delega en otro y graba cada respuesta exitosa como fixture. */
export function recordingClient(
  inner: ModelClient,
  store: FixtureStore,
  now: () => number = Date.now,
): ModelClient {
  return {
    async complete(request) {
      const started = now();
      const response = await inner.complete(request);
      const canary = canaryOf(request);
      await store.put(fixtureKey(request), {
        model: request.model,
        prompt_version: PROMPT_VERSION,
        text: canary === null ? response.text : response.text.replaceAll(canary, CANARY_MARK),
        input_tokens: response.inputTokens,
        output_tokens: response.outputTokens,
        latency_ms: Math.max(0, now() - started),
      });
      return response;
    },
  };
}
