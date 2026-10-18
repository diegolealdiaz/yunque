"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { z } from "zod";

import { errorMessage } from "../facturas/api-responses";
import { AgentIcon, CodeIcon, MailIcon, SendIcon } from "../../_components/icons";

/**
 * Conectar (D23, D24, D32): los canales reales de la demo para los clientes. Sin acceso, pide
 * el código que recibieron; con él, muestra la dirección de correo personal, el botón para
 * conectar Telegram, la llave de la API de decisión y el comando para conectar a Claude u otro
 * agente por MCP con esa misma llave. Las facturas que lleguen aparecen en Facturas como
 * cualquier otra, por su canal.
 */

export type ClientAccess = {
  /** Vencimiento del acceso, ya formateado; null si no hay acceso vigente. */
  readonly expires: string | null;
  /** Correo real encendido: dirección vigente, o null si todavía no se creó. */
  readonly email: { readonly address: string | null; readonly maxPerDay: number } | null;
  /** Telegram encendido: cuántos chats tiene conectados la empresa. */
  readonly telegram: { readonly chats: number; readonly maxPerDay: number } | null;
  /** URL pública de la app para el ejemplo de la API; null usa la de la pestaña. */
  readonly apiUrl: string | null;
};

/** La llave recién generada: se muestra esta única vez. */
const IssuedKeySchema = z.object({ key: z.string(), expiresAt: z.string() });
type IssuedKey = z.infer<typeof IssuedKeySchema> & {
  /** Llave de idempotencia del ejemplo, nueva cada vez: reusar una con otros datos da error. */
  readonly sampleKey: string;
};

/** Una solicitud de ejemplo, lista para pegar en una terminal. */
function curlExample(baseUrl: string, issued: IssuedKey): string {
  return [
    `curl ${baseUrl}/api/decide \\`,
    `  -H "Authorization: Bearer ${issued.key}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"idempotency_key":"${issued.sampleKey}","payee_name":"Proveedor S.A.S.",`,
    `       "invoice_number":"F-001","currency":"USD","total":"1200.00",`,
    `       "bank_account":"0012-3456-7890","due_date":"2026-11-15"}'`,
  ].join("\n");
}

async function post(url: string, body: unknown): Promise<{ ok: boolean; json: unknown }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: response.ok, json: await response.json().catch(() => null) };
}

/** El comando que conecta Claude Code con el MCP remoto de Yunque, con la llave puesta. */
function claudeCommand(baseUrl: string, key: string, multiline: boolean): string {
  const parts = [
    `claude mcp add --transport http yunque ${baseUrl}/api/mcp`,
    `--header "Authorization: Bearer ${key}"`,
  ];
  return multiline ? parts.join(" \\\n  ") : parts.join(" ");
}

/** La misma conexión para otros clientes MCP que leen su configuración de un archivo JSON. */
function mcpJson(baseUrl: string, key: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        yunque: { url: `${baseUrl}/api/mcp`, headers: { Authorization: `Bearer ${key}` } },
      },
    },
    null,
    2,
  );
}

function Section({
  title,
  Icon,
  children,
}: {
  readonly title: string;
  readonly Icon: (props: { className?: string }) => ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section className="space-y-2.5 card p-5">
      <h3 className="flex items-center gap-2.5 text-[14px] font-semibold text-ink">
        <span className="inline-flex size-8 items-center justify-center rounded-[9px] bg-brand-tint text-brand">
          <Icon className="size-4" />
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
}

export function AccessPanel({ access }: { readonly access: ClientAccess }) {
  const router = useRouter();
  const codeId = useId();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedKey | null>(null);

  async function run(action: () => Promise<{ ok: boolean; json: unknown }>, fallback: string) {
    setBusy(true);
    setError(null);
    try {
      const { ok, json } = await action();
      if (!ok) {
        setError(errorMessage(json, fallback));
        return null;
      }
      return json;
    } catch {
      setError("Sin conexión. Revisa la red y vuelve a intentar.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const json = await run(() => post("/api/acceso", { codigo: code }), "No se pudo dar acceso.");
    if (json !== null) {
      setCode("");
      router.refresh();
    }
  }

  async function createAddress() {
    const json = await run(() => post("/api/acceso", {}), "No se pudo crear la dirección.");
    if (json !== null) router.refresh();
  }

  async function connectTelegram() {
    const json = await run(() => post("/api/telegram/enlace", {}), "No se pudo crear el enlace.");
    if (
      typeof json === "object" &&
      json !== null &&
      "url" in json &&
      typeof json.url === "string"
    ) {
      setLink(json.url);
      window.open(json.url, "_blank", "noopener,noreferrer");
    }
  }

  async function issueKey() {
    const json = await run(() => post("/api/acceso/llave", {}), "No se pudo generar la llave.");
    const parsed = IssuedKeySchema.safeParse(json);
    if (parsed.success) setIssued({ ...parsed.data, sampleKey: `prueba-${String(Date.now())}` });
  }

  /** Copia un texto y marca qué se copió, para que solo ese botón diga «Copiada». */
  async function copy(what: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  }

  const failure = error ? (
    <p role="alert" className="text-[13px] text-hold">
      {error}
    </p>
  ) : null;

  if (access.expires === null) {
    return (
      <form onSubmit={unlock} className="space-y-3 text-[13px]">
        <p className="text-ink-2">
          Envía una factura real desde tu correo
          {access.telegram ? ", por Telegram" : ""} o desde tu propio agente, y mira cómo la decide
          Yunque. Esta opción es para los clientes: escribe el código de acceso que recibiste.
        </p>
        <label htmlFor={codeId} className="block text-[12px] text-ink-3">
          Código de acceso
        </label>
        <div className="flex gap-2">
          <input
            id={codeId}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            required
            className="h-8 min-w-0 flex-1 rounded-[var(--radius-control)] border border-control bg-surface px-2.5 font-mono text-[13px] text-ink"
          />
          <button
            type="submit"
            disabled={busy || code.trim() === ""}
            className="h-8 btn-primary px-3 text-[13px]"
          >
            {busy ? "Validando…" : "Entrar"}
          </button>
        </div>
        {failure}
      </form>
    );
  }

  return (
    <div className="space-y-3 text-[13px]">
      <p className="text-ink-2">
        Tu acceso vence el {access.expires}. Las facturas que envíes aparecen en esta lista con su
        veredicto. Yunque nunca responde ni reenvía correos.
      </p>

      {access.email ? (
        <Section title="Por correo" Icon={MailIcon}>
          {access.email.address ? (
            <>
              <p className="text-ink-2">Reenvía la factura en PDF o como foto a:</p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-[var(--radius-control)] border border-line bg-surface-sunken px-2.5 py-1.5 font-mono text-[12px] text-ink select-all">
                  {access.email.address}
                </code>
                <button
                  type="button"
                  onClick={() => void copy("email", access.email?.address ?? "")}
                  className="h-8 shrink-0 rounded-[var(--radius-control)] border border-control px-3 font-medium"
                >
                  {copied === "email" ? "Copiada" : "Copiar"}
                </button>
              </div>
              <p className="text-[12px] text-ink-3">
                Hasta {access.email.maxPerDay} correos por día. Si trae varios adjuntos, se lee el
                primero que sea factura.
              </p>
            </>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void createAddress()}
              className="h-8 rounded-[var(--radius-control)] border border-control px-3 font-medium"
            >
              Crear mi dirección
            </button>
          )}
        </Section>
      ) : null}

      {access.telegram ? (
        <Section title="Por Telegram" Icon={SendIcon}>
          <p className="text-ink-2">
            {access.telegram.chats > 0
              ? "Tu chat está conectado. Envíale al bot una factura en PDF o foto; también te avisa cuando una factura necesita tu decisión o se frena."
              : "Conecta tu chat: el bot te avisa cuando una factura necesita tu decisión o se frena, y puedes enviarle facturas en PDF o foto."}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void connectTelegram()}
            className="h-8 rounded-[var(--radius-control)] border border-control px-3 font-medium"
          >
            {access.telegram.chats > 0 ? "Conectar otro chat" : "Conectar Telegram"}
          </button>
          {link ? (
            <p className="text-[12px] text-ink-3">
              Si no se abrió,{" "}
              <a
                href={link}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-4"
              >
                abre este enlace
              </a>
              . Vale una hora y un solo uso.
            </p>
          ) : null}
          <p className="text-[12px] text-ink-3">
            Hasta {access.telegram.maxPerDay} facturas por día por chat. Para desconectar, escríbele
            /salir al bot.
          </p>
        </Section>
      ) : null}
      <Section title="Tu sistema, por la API" Icon={CodeIcon}>
        <p className="text-ink-2">
          Tu ERP o tu propio software le pregunta a Yunque antes de pagar y recibe pagar, frenar o
          escalar, con su porqué. Lo que escala te espera en Pendientes, como cualquier factura.
        </p>
        {issued ? (
          <>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-[var(--radius-control)] border border-line bg-surface-sunken px-2.5 py-1.5 font-mono text-[12px] text-ink select-all">
                {issued.key}
              </code>
              <button
                type="button"
                onClick={() => void copy("key", issued.key)}
                className="h-8 shrink-0 rounded-[var(--radius-control)] border border-control px-3 font-medium"
              >
                {copied === "key" ? "Copiada" : "Copiar"}
              </button>
            </div>
            <p className="text-[12px] text-ink-3">
              Guárdala ahora: no se vuelve a mostrar. Vence con tu acceso, y generar otra anula
              esta.
            </p>
            <pre className="overflow-x-auto rounded-[var(--radius-control)] border border-line bg-surface-sunken px-2.5 py-2 font-mono text-[11px] leading-relaxed text-ink">
              {curlExample(access.apiUrl ?? window.location.origin, issued)}
            </pre>
          </>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => void issueKey()}
            className="h-8 rounded-[var(--radius-control)] border border-control px-3 font-medium"
          >
            Generar llave
          </button>
        )}
      </Section>
      <Section title="Claude u otro agente de IA, por MCP" Icon={AgentIcon}>
        <p className="text-ink-2">
          Conecta tu asistente y pregúntale «¿pago esta factura?»: le pregunta a Yunque y responde
          con las reglas de tu empresa. Usa la misma llave de la API; no hay que instalar nada.
        </p>
        {issued ? (
          <>
            <p className="text-[12px] text-ink-3">En Claude Code, pega en la terminal:</p>
            <div className="flex items-start gap-2">
              <pre className="min-w-0 flex-1 overflow-x-auto rounded-[var(--radius-control)] border border-line bg-surface-sunken px-2.5 py-2 font-mono text-[11px] leading-relaxed text-ink">
                {claudeCommand(access.apiUrl ?? window.location.origin, issued.key, true)}
              </pre>
              <button
                type="button"
                onClick={() =>
                  void copy(
                    "claude",
                    claudeCommand(access.apiUrl ?? window.location.origin, issued.key, false),
                  )
                }
                className="h-8 shrink-0 rounded-[var(--radius-control)] border border-control px-3 font-medium"
              >
                {copied === "claude" ? "Copiado" : "Copiar"}
              </button>
            </div>
            <p className="text-[12px] text-ink-3">
              En otro cliente compatible con MCP, agrega esta conexión a su configuración:
            </p>
            <pre className="overflow-x-auto rounded-[var(--radius-control)] border border-line bg-surface-sunken px-2.5 py-2 font-mono text-[11px] leading-relaxed text-ink">
              {mcpJson(access.apiUrl ?? window.location.origin, issued.key)}
            </pre>
          </>
        ) : (
          <p className="text-[12px] text-ink-3">
            Genera la llave en «Tu sistema, por la API» y aquí aparece el comando, listo para
            copiar.
          </p>
        )}
      </Section>
      {failure}
    </div>
  );
}
