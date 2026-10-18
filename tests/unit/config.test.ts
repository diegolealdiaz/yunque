import { describe, expect, it } from "vitest";

import { ConfigError, loadConfig } from "@/src/config";

/** Entorno completo y válido, equivalente a .env.example con secretos puestos. */
const valid: Record<string, string> = {
  NODE_ENV: "test",
  OPENROUTER_API_KEY: "sk-or-test",
  MODEL_PRIMARY: "anthropic/claude-haiku-5.5",
  MODEL_FALLBACK: "anthropic/claude-sonnet-5.5",
  MODEL_MAX_OUTPUT_TOKENS: "1500",
  DATABASE_URL: "file:./data/yunque.db",
  DATABASE_AUTH_TOKEN: "",
  BLOB_READ_WRITE_TOKEN: "",
  APPROVAL_SIGNING_SECRET: "a".repeat(64),
  SESSION_SECRET: "b".repeat(64),
  SYSTEM_HARD_CAP_USD_CENTS: "10000000",
  DEMO_MODE: "true",
  MAX_UPLOAD_BYTES: "5242880",
  MAX_PAGES_RENDERED: "5",
  MAX_INVOICES_PER_VISITOR_PER_DAY: "50",
  MAX_INVOICES_PER_DAY: "500",
  DISPLAY_TIMEZONE: "America/Bogota",
  TELEGRAM_BOT_TOKEN: "",
  TELEGRAM_WEBHOOK_SECRET: "",
};

function without(name: string): Record<string, string | undefined> {
  const copy: Record<string, string | undefined> = { ...valid };
  delete copy[name];
  return copy;
}

function problemsOf(source: Record<string, string | undefined>): string[] {
  try {
    loadConfig(source);
  } catch (error) {
    if (error instanceof ConfigError) return [...error.problems];
    throw error;
  }
  throw new Error("se esperaba ConfigError");
}

describe("loadConfig (P-02)", () => {
  it("carga el entorno completo y expone valores tipados", () => {
    const config = loadConfig(valid);
    expect(config.env).toBe("test");
    expect(config.model?.primary).toBe("anthropic/claude-haiku-5.5");
    expect(config.model?.maxOutputTokens).toBe(1500);
    expect(config.database).toEqual({ url: "file:./data/yunque.db", authToken: null });
    expect(config.blob.token).toBeNull();
    expect(config.systemHardCapUsdCents).toBe(10_000_000);
    expect(config.demo).toEqual({
      enabled: true,
      maxUploadBytes: 5_242_880,
      maxPagesRendered: 5,
      maxInvoicesPerVisitorPerDay: 50,
      maxInvoicesPerDay: 500,
      maxOrganizationsPerDay: 200,
    });
    expect(config.displayTimeZone).toBe("America/Bogota");
    expect(config.telegram).toBeNull();
    expect(Object.isFrozen(config)).toBe(true);
  });

  it.each([
    "DATABASE_URL",
    "APPROVAL_SIGNING_SECRET",
    "SESSION_SECRET",
    "SYSTEM_HARD_CAP_USD_CENTS",
  ])("sin %s lanza un error que nombra la variable", (name) => {
    const problems = problemsOf(without(name));
    expect(problems.some((p) => p.includes(name))).toBe(true);
  });

  it("reporta todas las variables ausentes a la vez, no solo la primera", () => {
    const source = without("DATABASE_URL");
    delete source["SESSION_SECRET"];
    const problems = problemsOf(source);
    expect(problems.some((p) => p.includes("DATABASE_URL"))).toBe(true);
    expect(problems.some((p) => p.includes("SESSION_SECRET"))).toBe(true);
  });

  it("acepta la ausencia de clave del modelo fuera de producción y apaga el Lector", () => {
    const config = loadConfig(without("OPENROUTER_API_KEY"));
    expect(config.model).toBeNull();
  });

  it("exige la clave del modelo en producción", () => {
    const problems = problemsOf({ ...without("OPENROUTER_API_KEY"), NODE_ENV: "production" });
    expect(problems.some((p) => p.includes("OPENROUTER_API_KEY"))).toBe(true);
  });

  it("exige el almacén de Blob en Vercel, no en un servidor local", () => {
    const problems = problemsOf({ ...valid, VERCEL: "1" });
    expect(problems.some((p) => p.includes("BLOB_READ_WRITE_TOKEN"))).toBe(true);
    expect(problems.some((p) => p.includes("CRON_SECRET"))).toBe(true);
    expect(
      loadConfig({
        ...valid,
        VERCEL: "1",
        BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_x",
        CRON_SECRET: "c".repeat(64),
      }).blob.token,
    ).toBe("vercel_blob_rw_x");
    expect(loadConfig({ ...valid, NODE_ENV: "production" }).blob.token).toBeNull();
  });

  it("rechaza apagar la demo en producción mientras no haya inicio de sesión", () => {
    const problems = problemsOf({ ...valid, NODE_ENV: "production", DEMO_MODE: "false" });
    expect(problems.some((p) => p.includes("DEMO_MODE"))).toBe(true);
    expect(loadConfig({ ...valid, NODE_ENV: "production" }).demo.enabled).toBe(true);
  });

  it("rechaza secretos cortos", () => {
    const problems = problemsOf({ ...valid, SESSION_SECRET: "corto" });
    expect(problems.some((p) => p.includes("SESSION_SECRET"))).toBe(true);
  });

  it("rechaza que los dos secretos sean iguales", () => {
    const problems = problemsOf({ ...valid, SESSION_SECRET: valid["APPROVAL_SIGNING_SECRET"] });
    expect(problems.some((p) => p.includes("SESSION_SECRET"))).toBe(true);
  });

  it.each([
    ["SYSTEM_HARD_CAP_USD_CENTS", "0"],
    ["SYSTEM_HARD_CAP_USD_CENTS", "12.5"],
    ["SYSTEM_HARD_CAP_USD_CENTS", "mucho"],
    ["MAX_PAGES_RENDERED", "0"],
    ["MAX_PAGES_RENDERED", "21"],
    ["MAX_UPLOAD_BYTES", "999"],
    ["MODEL_MAX_OUTPUT_TOKENS", "10"],
    ["MAX_INVOICES_PER_DAY", "-1"],
  ])("rechaza %s=%s por estar fuera de rango", (name, value) => {
    const problems = problemsOf({ ...valid, [name]: value });
    expect(problems.some((p) => p.includes(name))).toBe(true);
  });

  it("rechaza que el tope por visitante supere el tope global", () => {
    const problems = problemsOf({ ...valid, MAX_INVOICES_PER_VISITOR_PER_DAY: "600" });
    expect(problems.some((p) => p.includes("MAX_INVOICES_PER_VISITOR_PER_DAY"))).toBe(true);
  });

  it("rechaza una zona horaria inexistente", () => {
    const problems = problemsOf({ ...valid, DISPLAY_TIMEZONE: "America/Ciudad_Inventada" });
    expect(problems.some((p) => p.includes("DISPLAY_TIMEZONE"))).toBe(true);
  });

  it("rechaza un booleano que no sea true o false", () => {
    const problems = problemsOf({ ...valid, DEMO_MODE: "si" });
    expect(problems.some((p) => p.includes("DEMO_MODE"))).toBe(true);
  });

  it("acepta false y 0 como booleanos falsos", () => {
    expect(loadConfig({ ...valid, DEMO_MODE: "false" }).demo.enabled).toBe(false);
    expect(loadConfig({ ...valid, DEMO_MODE: "0" }).demo.enabled).toBe(false);
  });

  it("aplica valores por defecto cuando una variable opcional no viene", () => {
    const source = without("MAX_PAGES_RENDERED");
    delete source["DISPLAY_TIMEZONE"];
    const config = loadConfig(source);
    expect(config.demo.maxPagesRendered).toBe(10);
    expect(config.displayTimeZone).toBe("America/Bogota");
  });

  it("Telegram exige token, secreto y nombre del bot juntos, y el código de acceso (D24)", () => {
    const problems = problemsOf({ ...valid, TELEGRAM_BOT_TOKEN: "123:abc" });
    expect(problems).toContain(
      "TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET y TELEGRAM_BOT_USERNAME van juntas: las tres o ninguna",
    );
    const bot = {
      ...valid,
      TELEGRAM_BOT_TOKEN: "123:abc",
      TELEGRAM_WEBHOOK_SECRET: "t".repeat(40),
      TELEGRAM_BOT_USERNAME: "YunqueBot",
    };
    expect(problemsOf(bot)).toContain(
      "DEMO_ACCESS_CODE es requerida con el correo real o Telegram encendidos",
    );
    const config = loadConfig({ ...bot, DEMO_ACCESS_CODE: "codigo-cliente-2026" });
    expect(config.telegram).toEqual({
      botToken: "123:abc",
      webhookSecret: "t".repeat(40),
      botUsername: "YunqueBot",
      maxPerChatPerDay: 10,
    });
    expect(config.access).toEqual({ code: "codigo-cliente-2026", ttlHours: 72 });
    // Telegram solo acepta secretos de 32 a 256 caracteres seguros, y el bot va sin @.
    expect(problemsOf({ ...bot, TELEGRAM_WEBHOOK_SECRET: "corto" })[0]).toContain(
      "TELEGRAM_WEBHOOK_SECRET",
    );
    expect(problemsOf({ ...bot, TELEGRAM_BOT_USERNAME: "@Yunque" })[0]).toContain(
      "TELEGRAM_BOT_USERNAME",
    );
    expect(problemsOf({ ...valid, PUBLIC_APP_URL: "http://inseguro.co" })[0]).toContain(
      "PUBLIC_APP_URL",
    );
    expect(loadConfig({ ...valid, PUBLIC_APP_URL: "https://yunque.app/" }).publicAppUrl).toBe(
      "https://yunque.app",
    );
  });

  it("una variable numérica vacía toma su valor por defecto", () => {
    expect(loadConfig({ ...valid, MAX_PAGES_RENDERED: "" }).demo.maxPagesRendered).toBe(10);
    expect(loadConfig({ ...valid, DEMO_MODE: "  " }).demo.enabled).toBe(true);
  });

  it.each(["0x10", "1e3", "1_000", "+5", " 5.0"])("rechaza el número %s", (value) => {
    const problems = problemsOf({ ...valid, MAX_PAGES_RENDERED: value });
    expect(problems).toContain("MAX_PAGES_RENDERED debe ser un número entero");
  });

  it("rechaza NODE_ENV desconocido y una subida mayor a 20 MB", () => {
    expect(problemsOf({ ...valid, NODE_ENV: "staging" })[0]).toContain("NODE_ENV");
    expect(problemsOf({ ...valid, MAX_UPLOAD_BYTES: String(21 * 1024 * 1024) })[0]).toContain(
      "MAX_UPLOAD_BYTES",
    );
  });

  it("no serializa secretos", () => {
    const config = loadConfig({
      ...valid,
      DATABASE_AUTH_TOKEN: "turso-secret-xyz",
      TELEGRAM_BOT_TOKEN: "1:a",
      TELEGRAM_WEBHOOK_SECRET: "s".repeat(40),
      TELEGRAM_BOT_USERNAME: "YunqueBot",
      DEMO_ACCESS_CODE: "codigo-secreto-2026",
    });
    const text = JSON.stringify(config);
    expect(text).not.toContain("sk-or-test");
    expect(text).not.toContain("a".repeat(64));
    expect(text).not.toContain("turso-secret-xyz");
    expect(text).not.toContain("1:a");
    expect(text).not.toContain("s".repeat(40));
    expect(text).not.toContain("codigo-secreto-2026");
    expect(text).toContain("[redactado]");
    expect(text).toContain("anthropic/claude-haiku-5.5");
    expect(config.model?.apiKey).toBe("sk-or-test");
  });

  it("el correo de entrada está apagado por defecto y exige sus valores al encenderlo (D23)", () => {
    expect(loadConfig(valid).inboundEmail).toBeNull();
    const on = { ...valid, INBOUND_EMAIL_ENABLED: "true" };
    const problems = problemsOf(on);
    expect(problems).toContain("INBOUND_EMAIL_ADDRESS es requerida con INBOUND_EMAIL_ENABLED=true");
    expect(problems).toContain(
      "INBOUND_EMAIL_WEBHOOK_SECRET es requerida con INBOUND_EMAIL_ENABLED=true",
    );
    expect(problems).toContain(
      "DEMO_ACCESS_CODE es requerida con el correo real o Telegram encendidos",
    );
    const complete = {
      ...on,
      INBOUND_EMAIL_ADDRESS: "abc123@inbound.postmarkapp.com",
      INBOUND_EMAIL_WEBHOOK_SECRET: "w".repeat(40),
      DEMO_ACCESS_CODE: "codigo-cliente-2026",
    };
    const config = loadConfig(complete);
    expect(config.inboundEmail).toMatchObject({
      address: "abc123@inbound.postmarkapp.com",
      maxPerAddressPerDay: 10,
      maxPerDay: 60,
    });
    const text = JSON.stringify(config);
    expect(text).not.toContain("w".repeat(40));
    expect(text).not.toContain("codigo-cliente-2026");
    // Código corto, dirección con +, fuera de la demo o tope por dirección mayor al global.
    expect(problemsOf({ ...complete, DEMO_ACCESS_CODE: "corto" })[0]).toContain("DEMO_ACCESS_CODE");
    expect(
      problemsOf({ ...complete, INBOUND_EMAIL_ADDRESS: "abc+x@inbound.postmarkapp.com" })[0],
    ).toContain("INBOUND_EMAIL_ADDRESS");
    expect(problemsOf({ ...complete, DEMO_MODE: "false" })).toContain(
      "El correo real y Telegram solo están permitidos en la demo (DEMO_MODE=true)",
    );
    expect(problemsOf({ ...complete, MAX_INBOUND_EMAILS_PER_ADDRESS_PER_DAY: "100" })).toContain(
      "MAX_INBOUND_EMAILS_PER_ADDRESS_PER_DAY no puede superar MAX_INBOUND_EMAILS_PER_DAY",
    );
  });

  it("ignora espacios alrededor de los valores", () => {
    const config = loadConfig({ ...valid, DATABASE_URL: "  file:./x.db  " });
    expect(config.database.url).toBe("file:./x.db");
  });
});
