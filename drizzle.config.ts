import { defineConfig } from "drizzle-kit";

/**
 * Configuración de drizzle-kit para generar migraciones desde `src/db/schema.ts`.
 * Las credenciales solo se usan con `drizzle-kit push` o `studio`; las migraciones
 * se aplican desde la app con `npm run db:migrate`.
 */
export default defineConfig({
  dialect: "turso",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dbCredentials: {
    url: process.env["DATABASE_URL"] ?? "file:./data/yunque.db",
    authToken: process.env["DATABASE_AUTH_TOKEN"] || undefined,
  },
  strict: true,
  verbose: false,
});
