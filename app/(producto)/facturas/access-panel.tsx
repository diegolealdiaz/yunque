"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent, type ReactNode } from "react";

import { errorMessage } from "./api-responses";

/**
 * Probar con tu factura (D23, D24): los canales reales de la demo para los clientes. Sin
 * acceso, pide el código que recibieron; con él, muestra la dirección de correo personal y
 * el botón para conectar Telegram. Las facturas que lleguen aparecen en la lista como
 * cualquier otra, por su canal.
 */

export type ClientAccess = {
  /** Vencimiento del acceso, ya formateado; null si no hay acceso vigente. */
  readonly expires: string | null;
  /** Correo real encendido: dirección vigente, o null si todavía no se creó. */
  readonly email: { readonly address: string | null; readonly maxPerDay: number } | null;
  /** Telegram encendido: cuántos chats tiene conectados la empresa. */
  readonly telegram: { readonly chats: number; readonly maxPerDay: number } | null;
};

async function post(url: string, body: unknown): Promise<{ ok: boolean; json: unknown }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: response.ok, json: await response.json().catch(() => null) };
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="space-y-2 border-t border-line pt-3">
      <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
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
  const [copied, setCopied] = useState(false);
  const [link, setLink] = useState<string | null>(null);

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

  async function copy(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
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
          {access.telegram ? " o por Telegram" : ""} y mira cómo la decide el agente. Esta opción es
          para los clientes: escribe el código de acceso que recibiste.
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
            className="h-8 rounded-[var(--radius-control)] bg-ink px-3 text-[13px] font-medium text-surface disabled:opacity-50"
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
        <Section title="Por correo">
          {access.email.address ? (
            <>
              <p className="text-ink-2">Reenvía la factura en PDF o como foto a:</p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-[var(--radius-control)] border border-line bg-surface-sunken px-2.5 py-1.5 font-mono text-[12px] text-ink select-all">
                  {access.email.address}
                </code>
                <button
                  type="button"
                  onClick={() => void copy(access.email?.address ?? "")}
                  className="h-8 shrink-0 rounded-[var(--radius-control)] border border-control px-3 font-medium"
                >
                  {copied ? "Copiada" : "Copiar"}
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
        <Section title="Por Telegram">
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
      {failure}
    </div>
  );
}
