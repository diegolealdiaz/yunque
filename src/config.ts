import { z } from "zod";

/**
 * Configuración del sistema, leída una sola vez desde las variables de entorno.
 *
 * Reglas:
 * - Todo valor pasa por un esquema. Nada se lee de process.env fuera de este módulo.
 * - Si falta una variable requerida o un valor está fuera de rango, loadConfig lanza
 *   ConfigError con la lista completa de problemas y el nombre de cada variable.
 * - Un valor vacío en el archivo .env cuenta como ausente: aplica el valor por defecto
 *   si lo hay, o el error de "requerida" si no.
 * - La clave del modelo es requerida en producción. En desarrollo puede faltar: entonces
 *   config.model es null y el Lector queda apagado, lo que la pipeline trata como
 *   "no pude leer la factura" (nunca como una lectura válida).
 * - Los secretos no se serializan: `JSON.stringify(config)` los redacta.
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

/** Vacío o solo espacios se trata como ausente, así aplica el valor por defecto o el error. */
const blankToUndefined = (v: unknown): unknown =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

/** Envuelve un esquema para que lea una variable de entorno: el vacío cuenta como ausente. */
const env = <T extends z.ZodType>(schema: T) => z.preprocess(blankToUndefined, schema);

const text = (name: string) =>
  z
    .string({ error: `${name} es requerida` })
    .trim()
    .min(1, { error: `${name} es requerida` });

const secret = (name: string) =>
  z
    .string({ error: `${name} es requerida` })
    .trim()
    .min(32, { error: `${name} debe tener al menos 32 caracteres` });

/** Entero decimal en base diez. Rechaza notación científica, hexadecimal, signo y decimales. */
const integer = (name: string, min: number, max: number) =>
  z
    .string({ error: `${name} es requerida` })
    .trim()
    .regex(/^[0-9]+$/, { error: `${name} debe ser un número entero` })
    .transform(Number)
    .pipe(
      z
        .number()
        .min(min, { error: `${name} debe ser al menos ${String(min)}` })
        .max(max, { error: `${name} debe ser como máximo ${String(max)}` }),
    );

const boolean = (name: string) =>
  z
    .string({ error: `${name} es requerida` })
    .trim()
    .toLowerCase()
    .pipe(z.enum(["true", "false", "1", "0"], { error: `${name} debe ser true o false` }))
    .transform((v) => v === "true" || v === "1");

const timeZone = (name: string) =>
  text(name).refine(
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

const EnvSchema = z.object({
  NODE_ENV: env(z.enum(["development", "test", "production"]).default("development")),

  OPENROUTER_API_KEY: env(text("OPENROUTER_API_KEY").optional()),
  MODEL_PRIMARY: env(text("MODEL_PRIMARY").default("anthropic/claude-haiku-5.5")),
  MODEL_FALLBACK: env(text("MODEL_FALLBACK").default("anthropic/claude-sonnet-5.5")),
  MODEL_MAX_OUTPUT_TOKENS: env(integer("MODEL_MAX_OUTPUT_TOKENS", 256, 8192).default(1500)),

  DATABASE_URL: env(text("DATABASE_URL")),
  DATABASE_AUTH_TOKEN: env(text("DATABASE_AUTH_TOKEN").optional()),

  BLOB_READ_WRITE_TOKEN: env(text("BLOB_READ_WRITE_TOKEN").optional()),

  APPROVAL_SIGNING_SECRET: env(secret("APPROVAL_SIGNING_SECRET")),
  SESSION_SECRET: env(secret("SESSION_SECRET")),

  SYSTEM_HARD_CAP_USD_CENTS: env(integer("SYSTEM_HARD_CAP_USD_CENTS", 1, 100_000_000_000)),

  DEMO_MODE: env(boolean("DEMO_MODE").default(true)),
  MAX_UPLOAD_BYTES: env(integer("MAX_UPLOAD_BYTES", 1024, 20 * MB).default(5 * MB)),
  MAX_PAGES_RENDERED: env(integer("MAX_PAGES_RENDERED", 1, 20).default(5)),
  MAX_INVOICES_PER_VISITOR_PER_DAY: env(
    integer("MAX_INVOICES_PER_VISITOR_PER_DAY", 1, 10_000).default(50),
  ),
  MAX_INVOICES_PER_DAY: env(integer("MAX_INVOICES_PER_DAY", 1, 100_000).default(500)),

  DISPLAY_TIMEZONE: env(timeZone("DISPLAY_TIMEZONE").default("America/Bogota")),

  TELEGRAM_BOT_TOKEN: env(text("TELEGRAM_BOT_TOKEN").optional()),
  TELEGRAM_WEBHOOK_SECRET: env(
    text("TELEGRAM_WEBHOOK_SECRET")
      .pipe(
        z.string().regex(/^[A-Za-z0-9_-]{32,256}$/, {
          error:
            "TELEGRAM_WEBHOOK_SECRET debe tener entre 32 y 256 letras, números, _ o - (lo exige Telegram)",
        }),
      )
      .optional(),
  ),
  TELEGRAM_BOT_USERNAME: env(
    text("TELEGRAM_BOT_USERNAME")
      .pipe(
        z.string().regex(/^[A-Za-z0-9_]{5,32}$/, {
          error: "TELEGRAM_BOT_USERNAME es el nombre del bot sin @, por ejemplo YunqueBot",
        }),
      )
      .optional(),
  ),
  TELEGRAM_MAX_PER_CHAT_PER_DAY: env(integer("TELEGRAM_MAX_PER_CHAT_PER_DAY", 1, 1000).default(10)),

  PUBLIC_APP_URL: env(
    text("PUBLIC_APP_URL")
      .pipe(
        z.url({
          protocol: /^https$/,
          error: "PUBLIC_APP_URL debe ser una URL https, por ejemplo https://yunque.vercel.app",
        }),
      )
      .transform((u) => u.replace(/\/+$/, ""))
      .optional(),
  ),

  DEMO_ACCESS_CODE: env(
    text("DEMO_ACCESS_CODE")
      .pipe(z.string().min(12, { error: "DEMO_ACCESS_CODE debe tener al menos 12 caracteres" }))
      .optional(),
  ),
  DEMO_ACCESS_TTL_HOURS: env(integer("DEMO_ACCESS_TTL_HOURS", 1, 720).default(72)),

  INBOUND_EMAIL_ENABLED: env(boolean("INBOUND_EMAIL_ENABLED").default(false)),
  INBOUND_EMAIL_ADDRESS: env(
    text("INBOUND_EMAIL_ADDRESS")
      .pipe(z.email({ error: "INBOUND_EMAIL_ADDRESS debe ser una dirección de correo" }))
      .refine((a) => !a.split("@")[0]?.includes("+"), {
        error: "INBOUND_EMAIL_ADDRESS va sin la parte después del +: Yunque la agrega",
      })
      .optional(),
  ),
  INBOUND_EMAIL_WEBHOOK_SECRET: env(secret("INBOUND_EMAIL_WEBHOOK_SECRET").optional()),
  MAX_INBOUND_EMAILS_PER_ADDRESS_PER_DAY: env(
    integer("MAX_INBOUND_EMAILS_PER_ADDRESS_PER_DAY", 1, 1000).default(10),
  ),
  MAX_INBOUND_EMAILS_PER_DAY: env(integer("MAX_INBOUND_EMAILS_PER_DAY", 1, 10_000).default(60)),
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
  /**
   * Bot de Telegram (D24): avisos y entrada de facturas para chats conectados. null cuando
   * falta el bot: el aviso por Telegram queda simulado (D21) y la pantalla no lo ofrece.
   */
  readonly telegram: TelegramConfig | null;
  /**
   * Código de acceso de los jurados (D23, D24): abre el correo real y la conexión de
   * Telegram durante `ttlHours`. null cuando ninguno de los dos está encendido.
   */
  readonly access: { readonly code: string; readonly ttlHours: number } | null;
  /** URL pública de la app, para los enlaces de los avisos. null en local. */
  readonly publicAppUrl: string | null;
  /**
   * Correo real de entrada (D23). null cuando está apagado: las rutas responden 404 y la
   * pantalla no lo ofrece. Solo existe en la demo.
   */
  readonly inboundEmail: InboundEmailConfig | null;
};

export type TelegramConfig = {
  readonly botToken: string;
  /** Lo que Telegram manda en `X-Telegram-Bot-Api-Secret-Token` en cada llamada al webhook. */
  readonly webhookSecret: string;
  /** Nombre del bot sin @: arma el enlace de conexión `t.me/<bot>?start=<token>`. */
  readonly botUsername: string;
  readonly maxPerChatPerDay: number;
};

export type InboundEmailConfig = {
  /** Dirección de entrada del proveedor, sin la parte después del +. */
  readonly address: string;
  /** Contraseña de la autenticación básica con la que el proveedor llama al webhook. */
  readonly webhookSecret: string;
  readonly maxPerAddressPerDay: number;
  readonly maxPerDay: number;
};

/** Validaciones que relacionan varias variables entre sí. */
function crossChecks(env: Env): string[] {
  const problems: string[] = [];

  if (env.NODE_ENV === "production" && env.OPENROUTER_API_KEY === undefined) {
    problems.push("OPENROUTER_API_KEY es requerida en producción");
  }

  // Fuera de la demo, quien firma es solo un nombre elegido de la lista: no hay inicio de
  // sesión que lo respalde. Hasta que exista, producción solo corre como demo aislada.
  if (env.NODE_ENV === "production" && !env.DEMO_MODE) {
    problems.push("DEMO_MODE=false no está permitido en producción: aún no hay inicio de sesión");
  }

  if (env.MAX_INVOICES_PER_VISITOR_PER_DAY > env.MAX_INVOICES_PER_DAY) {
    problems.push("MAX_INVOICES_PER_VISITOR_PER_DAY no puede superar MAX_INVOICES_PER_DAY");
  }

  if (env.INBOUND_EMAIL_ENABLED) {
    for (const name of ["INBOUND_EMAIL_ADDRESS", "INBOUND_EMAIL_WEBHOOK_SECRET"] as const) {
      if (env[name] === undefined)
        problems.push(`${name} es requerida con INBOUND_EMAIL_ENABLED=true`);
    }
    if (env.MAX_INBOUND_EMAILS_PER_ADDRESS_PER_DAY > env.MAX_INBOUND_EMAILS_PER_DAY) {
      problems.push(
        "MAX_INBOUND_EMAILS_PER_ADDRESS_PER_DAY no puede superar MAX_INBOUND_EMAILS_PER_DAY",
      );
    }
  }

  const telegramVars = [
    env.TELEGRAM_BOT_TOKEN,
    env.TELEGRAM_WEBHOOK_SECRET,
    env.TELEGRAM_BOT_USERNAME,
  ].filter((v) => v !== undefined).length;
  if (telegramVars !== 0 && telegramVars !== 3) {
    problems.push(
      "TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET y TELEGRAM_BOT_USERNAME van juntas: las tres o ninguna",
    );
  }

  // El correo real y Telegram se abren con el código de acceso, y solo existen en la demo.
  const judgeChannels = env.INBOUND_EMAIL_ENABLED || telegramVars === 3;
  if (judgeChannels && env.DEMO_ACCESS_CODE === undefined) {
    problems.push("DEMO_ACCESS_CODE es requerida con el correo real o Telegram encendidos");
  }
  if (judgeChannels && !env.DEMO_MODE) {
    problems.push("El correo real y Telegram solo están permitidos en la demo (DEMO_MODE=true)");
  }

  if (env.APPROVAL_SIGNING_SECRET === env.SESSION_SECRET) {
    problems.push("APPROVAL_SIGNING_SECRET y SESSION_SECRET deben ser distintas");
  }

  return problems;
}

const REDACTED = "[redactado]";

function toConfig(env: Env): Config {
  const config: Config = {
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
      env.TELEGRAM_BOT_TOKEN !== undefined &&
      env.TELEGRAM_WEBHOOK_SECRET !== undefined &&
      env.TELEGRAM_BOT_USERNAME !== undefined
        ? {
            botToken: env.TELEGRAM_BOT_TOKEN,
            webhookSecret: env.TELEGRAM_WEBHOOK_SECRET,
            botUsername: env.TELEGRAM_BOT_USERNAME,
            maxPerChatPerDay: env.TELEGRAM_MAX_PER_CHAT_PER_DAY,
          }
        : null,
    access:
      env.DEMO_ACCESS_CODE !== undefined
        ? { code: env.DEMO_ACCESS_CODE, ttlHours: env.DEMO_ACCESS_TTL_HOURS }
        : null,
    publicAppUrl: env.PUBLIC_APP_URL ?? null,
    inboundEmail:
      env.INBOUND_EMAIL_ENABLED &&
      env.INBOUND_EMAIL_ADDRESS !== undefined &&
      env.INBOUND_EMAIL_WEBHOOK_SECRET !== undefined
        ? {
            address: env.INBOUND_EMAIL_ADDRESS,
            webhookSecret: env.INBOUND_EMAIL_WEBHOOK_SECRET,
            maxPerAddressPerDay: env.MAX_INBOUND_EMAILS_PER_ADDRESS_PER_DAY,
            maxPerDay: env.MAX_INBOUND_EMAILS_PER_DAY,
          }
        : null,
  };

  // Redacción al serializar: un `console.error(config)` o un log de error nunca vuelca secretos.
  Object.defineProperty(config, "toJSON", {
    enumerable: false,
    value: (): unknown => ({
      ...config,
      model: config.model === null ? null : { ...config.model, apiKey: REDACTED },
      database: { ...config.database, authToken: config.database.authToken && REDACTED },
      blob: { token: config.blob.token && REDACTED },
      secrets: { approvalSigning: REDACTED, session: REDACTED },
      telegram:
        config.telegram === null
          ? null
          : { ...config.telegram, botToken: REDACTED, webhookSecret: REDACTED },
      access: config.access === null ? null : { ...config.access, code: REDACTED },
      inboundEmail:
        config.inboundEmail === null ? null : { ...config.inboundEmail, webhookSecret: REDACTED },
    }),
  });

  return Object.freeze(config);
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

  return toConfig(parsed.data);
}

let cached: Config | undefined;

/** Configuración del proceso actual. Se valida en la primera llamada y se reutiliza. */
export function getConfig(): Config {
  cached ??= loadConfig(process.env);
  return cached;
}
