"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";

import { errorMessage } from "./api-responses";

/**
 * Recibir por correo (D23). Sin dirección, pide el código de acceso que tienen los jurados;
 * con ella, la muestra para copiarla, con su vencimiento y su tope del día. Las facturas que
 * lleguen aparecen en la lista como cualquier otra, por el canal Correo.
 */
export function EmailPanel({
  address,
  expires,
  maxPerDay,
}: {
  /** Dirección vigente del visitante, o null si todavía no pidió una o ya venció. */
  readonly address: string | null;
  /** Vencimiento ya formateado para la pantalla. */
  readonly expires: string | null;
  readonly maxPerDay: number;
}) {
  const router = useRouter();
  const codeId = useId();
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/correo/direccion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ codigo: code }),
      });
      if (!response.ok) {
        const json: unknown = await response.json().catch(() => null);
        setError(errorMessage(json, "No se pudo crear la dirección."));
        return;
      }
      setCode("");
      router.refresh();
    } catch {
      setError("Sin conexión. Revisa la red y vuelve a intentar.");
    } finally {
      setSending(false);
    }
  }

  async function copy() {
    if (address === null) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (address === null) {
    return (
      <form onSubmit={submit} className="space-y-3 text-[13px]">
        <p className="text-ink-2">
          Envía una factura real desde tu correo y mira cómo la decide el agente. Esta opción es
          para los jurados: escribe el código de acceso que recibiste.
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
            disabled={sending || code.trim() === ""}
            className="h-8 rounded-[var(--radius-control)] bg-ink px-3 text-[13px] font-medium text-surface disabled:opacity-50"
          >
            {sending ? "Creando…" : "Crear mi dirección"}
          </button>
        </div>
        {error ? (
          <p role="alert" className="text-hold">
            {error}
          </p>
        ) : null}
      </form>
    );
  }

  return (
    <div className="space-y-3 text-[13px]">
      <p className="text-ink-2">Reenvía una factura a esta dirección:</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-[var(--radius-control)] border border-line bg-surface-sunken px-2.5 py-1.5 font-mono text-[12px] text-ink select-all">
          {address}
        </code>
        <button
          type="button"
          onClick={copy}
          className="h-8 shrink-0 rounded-[var(--radius-control)] border border-control px-3 text-[13px] font-medium"
        >
          {copied ? "Copiada" : "Copiar"}
        </button>
      </div>
      <ul className="list-disc space-y-1 pl-5 text-ink-2">
        <li>Adjunta la factura en PDF o como foto. Si trae varios adjuntos, se lee el primero.</li>
        <li>En unos segundos aparece en esta lista, con su veredicto y el canal Correo.</li>
        <li>
          Hasta {maxPerDay} correos por día. La dirección es solo tuya y vence el {expires}.
        </li>
        <li>Yunque nunca responde ni reenvía correos.</li>
      </ul>
    </div>
  );
}
