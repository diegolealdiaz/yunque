import { z } from "zod";

/**
 * Configuración del sistema, leída una sola vez desde las variables de entorno.
 *
 * Reglas:
 * - Todo valor pasa por un esquema. Nada se lee de process.env fuera de este módulo.
 * - Si falta una variable requerida o un valor está fuera de rango, loadConfig lanza
 *   ConfigError con la lista completa de problemas y el nombre de cada variable.
 * - La clave del modelo es requerida en producción. En desarrollo puede faltar: entonces
 *   config.model es null y el Lector queda apagado, lo que la pipeline trata como
 *   "no pude leer la factura" (nunca como una lectura válida).
 */

export class ConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Configuración inválida:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
}

const MB = 1024 * 1024;

const nonEmpty = (name: string) =>
  z
    .string({ error: `${name} es requerida` })
    .trim()
    .min(1, { error: `${name} es requerida` });

const secret = (name: string) =>
  nonEmpty(name).min(32, { error: `${name} debe tener al menos 32 caracteres` });

const integer = (name: string, min: number, max: number) =>
  z.coerce
    .number({ error: `${name} debe ser un número entero` })
    .int({ error: `${name} debe ser un número entero` })
    .min(min, { error: `${name} debe ser al menos ${min}` })
    .max(max, { error: `${name} debe ser como máximo ${max}` });

const boolean = (name: string) =>
  z
    .string()
    .trim()
    .toLowerCase()
    .pipe(
      z.enum(["true", "false", "1", "0"], {
        error: `${name} debe ser true o false`,
      }),
    )
    .transform((v) => v === "true" || v === "1");

const timeZone = (name: string) =>
  nonEmpty(name).refine(
    (tz) => {
      try {
        new Intl.DateTimeFormat("es", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    },
    { error: `${name} no es una zona horaria válida` },
  );

/** Un valor vacío en el archivo .env cuenta como ausente. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    schema.optional(),
  );

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  OPENROUTER_API_KEY: optional(nonEmpty("OPENROUTER_API_KEY")),
  MODEL_PRIMARY: nonEmpty("MODEL_PRIMARY").default("anthropic/claude-haiku-5.5"),
  MODEL_FALLBACK: nonEmpty("MODEL_FALLBACK").default("anthropic/claude-sonnet-5.5"),
  MODEL_MAX_OUTPUT_TOKENS: integer("MODEL_MAX_OUTPUT_TOKENS", 256, 8192).default(1500),

  DATABASE_URL: nonEmpty("DATABASE_URL"),
  DATABASE_AUTH_TOKEN: optional(nonEmpty("DATABASE_AUTH_TOKEN")),

  BLOB_READ_WRITE_TOKEN: optional(nonEmpty("BLOB_READ_WRITE_TOKEN")),

  APPROVAL_SIGNING_SECRET: secret("APPROVAL_SIGNING_SECRET"),
  SESSION_SECRET: secret("SESSION_SECRET"),

  SYSTEM_HARD_CAP_USD_CENTS: integer("SYSTEM_HARD_CAP_USD_CENTS", 1, 1_000_000_000_00),

  DEMO_MODE: boolean("DEMO_MODE").default(true),
  MAX_UPLOAD_BYTES: integer("MAX_UPLOAD_BYTES", 1024, 20 * MB).default(5 * MB),
  MAX_PAGES_RENDERED: integer("MAX_PAGES_RENDERED", 1, 20).default(5),
  MAX_INVOICES_PER_VISITOR_PER_DAY: integer("MAX_INVOICES_PER_VISITOR_PER_DAY", 1, 10_000).default(
    50,
  ),
  MAX_INVOICES_PER_DAY: integer("MAX_INVOICES_PER_DAY", 1, 100_000).default(500),

  DISPLAY_TIMEZONE: timeZone("DISPLAY_TIMEZONE").default("America/Bogota"),

  TELEGRAM_BOT_TOKEN: optional(nonEmpty("TELEGRAM_BOT_TOKEN")),
  TELEGRAM_WEBHOOK_SECRET: optional(nonEmpty("TELEGRAM_WEBHOOK_SECRET")),
});

type Env = z.infer<typeof EnvSchema>;

export type ModelConfig = {
  readonly apiKey: string;
  readonly primary: string;
  readonly fallback: string;
  readonly maxOutputTokens: number;
};

export type Config = {
  readonly env: "development" | "test" | "production";
  /** null cuando no hay clave: el Lector está apagado. Solo permitido fuera de producción. */
  readonly model: ModelConfig | null;
  readonly database: { readonly url: string; readonly authToken: string | null };
  readonly blob: { readonly token: string | null };
  readonly secrets: { readonly approvalSigning: string; readonly session: string };
  /** Tope absoluto por pago en centavos de USD. Ninguna política puede superarlo. */
  readonly systemHardCapUsdCents: number;
  readonly demo: {
    readonly enabled: boolean;
    readonly maxUploadBytes: number;
    readonly maxPagesRendered: number;
    readonly maxInvoicesPerVisitorPerDay: number;
    readonly maxInvoicesPerDay: number;
  };
  readonly displayTimeZone: string;
  readonly telegram: { readonly botToken: string; readonly webhookSecret: string } | null;
};

/** Validaciones que relacionan varias variables entre sí. */
function crossChecks(env: Env): string[] {
  const problems: string[] = [];

  if (env.NODE_ENV === "production" && env.OPENROUTER_API_KEY === undefined) {
    problems.push("OPENROUTER_API_KEY es requerida en producción");
  }

  if (env.MAX_INVOICES_PER_VISITOR_PER_DAY > env.MAX_INVOICES_PER_DAY) {
    problems.push("MAX_INVOICES_PER_VISITOR_PER_DAY no puede superar MAX_INVOICES_PER_DAY");
  }

  const hasToken = env.TELEGRAM_BOT_TOKEN !== undefined;
  const hasSecret = env.TELEGRAM_WEBHOOK_SECRET !== undefined;
  if (hasToken !== hasSecret) {
    problems.push("TELEGRAM_BOT_TOKEN y TELEGRAM_WEBHOOK_SECRET van juntas: ambas o ninguna");
  }

  if (env.APPROVAL_SIGNING_SECRET === env.SESSION_SECRET) {
    problems.push("APPROVAL_SIGNING_SECRET y SESSION_SECRET deben ser distintas");
  }

  return problems;
}

function toConfig(env: Env): Config {
  return {
    env: env.NODE_ENV,
    model:
      env.OPENROUTER_API_KEY === undefined
        ? null
        : {
            apiKey: env.OPENROUTER_API_KEY,
            primary: env.MODEL_PRIMARY,
            fallback: env.MODEL_FALLBACK,
            maxOutputTokens: env.MODEL_MAX_OUTPUT_TOKENS,
          },
    database: { url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN ?? null },
    blob: { token: env.BLOB_READ_WRITE_TOKEN ?? null },
    secrets: { approvalSigning: env.APPROVAL_SIGNING_SECRET, session: env.SESSION_SECRET },
    systemHardCapUsdCents: env.SYSTEM_HARD_CAP_USD_CENTS,
    demo: {
      enabled: env.DEMO_MODE,
      maxUploadBytes: env.MAX_UPLOAD_BYTES,
      maxPagesRendered: env.MAX_PAGES_RENDERED,
      maxInvoicesPerVisitorPerDay: env.MAX_INVOICES_PER_VISITOR_PER_DAY,
      maxInvoicesPerDay: env.MAX_INVOICES_PER_DAY,
    },
    displayTimeZone: env.DISPLAY_TIMEZONE,
    telegram:
      env.TELEGRAM_BOT_TOKEN !== undefined && env.TELEGRAM_WEBHOOK_SECRET !== undefined
        ? { botToken: env.TELEGRAM_BOT_TOKEN, webhookSecret: env.TELEGRAM_WEBHOOK_SECRET }
        : null,
  };
}

/**
 * Construye la configuración a partir de un diccionario de variables.
 * Pura: recibe el entorno como argumento para que las pruebas no toquen process.env.
 */
export function loadConfig(source: Readonly<Record<string, string | undefined>>): Config {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => {
      const name = issue.path.map(String).join(".");
      return issue.message.startsWith(name) ? issue.message : `${name}: ${issue.message}`;
    });
    throw new ConfigError(problems);
  }

  const problems = crossChecks(parsed.data);
  if (problems.length > 0) {
    throw new ConfigError(problems);
  }

  return Object.freeze(toConfig(parsed.data));
}

let cached: Config | undefined;

/** Configuración del proceso actual. Se valida en la primera llamada y se reutiliza. */
export function getConfig(): Config {
  cached ??= loadConfig(process.env);
  return cached;
}
