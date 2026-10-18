"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type DragEvent } from "react";

import { VerdictChip } from "../../_components/verdict-chip";

import { ProcessResponseSchema, errorMessage, type ProcessResponse } from "./api-responses";

/**
 * Subida en pantalla (docs/arquitectura.md §5): arrastrar o elegir PDF, imagen o correo en
 * JSON. Cada archivo elegido recibe su llave de entrega en el navegador y "Reintentar" la
 * reusa, así un corte de red no duplica la factura. Varios archivos se envían de a uno, en
 * orden. El tipo se valida aquí para avisar rápido, y de verdad en el servidor, por contenido.
 */

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.json,application/pdf,image/png,image/jpeg,application/json";

type Upload = {
  readonly key: string;
  readonly name: string;
  readonly state: "subiendo" | "listo" | "error";
  readonly verdict?: ProcessResponse["verdict"];
  readonly invoiceId?: string;
  readonly reference?: string;
  readonly message?: string;
  /** Falló la red, no el servidor: se puede reintentar con la misma llave. */
  readonly retryable?: boolean;
};

/** Tamaño en megas para la persona: "4 MB", "4,6 MB". */
function megabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toLocaleString("es-CO", { maximumFractionDigits: 1 })} MB`;
}

export function UploadPanel({ maxBytes }: { readonly maxBytes: number }) {
  const router = useRouter();
  const inputId = useId();
  const [uploads, setUploads] = useState<readonly Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  // El archivo de cada entrega, para reintentarla con la misma llave.
  const files = useRef(new Map<string, File>());

  const update = (key: string, patch: Partial<Upload>) =>
    setUploads((all) => all.map((u) => (u.key === key ? { ...u, ...patch } : u)));

  async function send(file: File) {
    const key = `upload:${crypto.randomUUID()}`;
    files.current.set(key, file);
    setUploads((all) => [{ key, name: file.name, state: "subiendo" }, ...all]);
    await upload(key, file);
  }

  async function upload(key: string, file: File) {
    update(key, { state: "subiendo", retryable: false });
    if (file.size > maxBytes) {
      update(key, {
        state: "error",
        message: `Pesa ${megabytes(file.size)} y el máximo es ${megabytes(maxBytes)}. Sube uno más liviano.`,
      });
      return;
    }
    const body = new FormData();
    body.set("archivo", file);
    body.set("llave", key);
    try {
      const response = await fetch("/api/procesar", { method: "POST", body });
      const json: unknown = await response.json().catch(() => null);
      const result = ProcessResponseSchema.safeParse(json);
      if (!response.ok || !result.success) {
        update(key, {
          state: "error",
          message: errorMessage(json, "No se pudo procesar el archivo."),
        });
        return;
      }
      update(key, {
        state: "listo",
        verdict: result.data.verdict,
        invoiceId: result.data.invoiceId,
        reference: result.data.reference,
      });
      router.refresh();
    } catch {
      update(key, { state: "error", message: "Sin conexión.", retryable: true });
    }
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    void sendAll(Array.from(event.dataTransfer.files));
  }

  async function sendAll(list: readonly File[]) {
    for (const file of list) await send(file);
  }

  return (
    <div className="space-y-3">
      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`block cursor-pointer rounded-[var(--radius-card)] border border-dashed px-6 py-6 text-center text-[13px] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)] ${dragging ? "border-ink bg-surface-hover" : "border-line-strong bg-surface"}`}
      >
        <span className="block font-medium text-ink">Arrastra facturas aquí o elige archivos</span>
        <span className="mt-1 block text-ink-2">
          PDF, PNG, JPG o correo en JSON · hasta {megabytes(maxBytes)}
        </span>
        <input
          id={inputId}
          type="file"
          multiple
          accept={ACCEPT}
          aria-label="Elegir facturas para subir"
          className="sr-only"
          onChange={(e) => {
            void sendAll(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </label>
      {uploads.length > 0 ? (
        <ul aria-live="polite" className="divide-y divide-line card text-[13px]">
          {uploads.map((u) => (
            <li
              key={u.key}
              className="relative flex items-center gap-3 px-3 py-2 has-[a]:hover:bg-surface-hover"
            >
              <span className="min-w-0 flex-1 truncate text-ink">{u.name}</span>
              {u.state === "subiendo" ? <VerdictChip verdict="en_proceso" /> : null}
              {u.state === "listo" && u.verdict ? <VerdictChip verdict={u.verdict} /> : null}
              {u.state === "listo" && u.invoiceId ? (
                // El enlace cubre toda la fila: se abre el detalle desde el nombre, el veredicto
                // o la referencia.
                <Link
                  href={`/facturas/${u.invoiceId}`}
                  className="font-medium text-ink underline underline-offset-4 after:absolute after:inset-0 after:content-['']"
                >
                  {u.reference ?? "ver"}
                </Link>
              ) : null}
              {u.state === "error" ? (
                <span role="alert" className="text-hold">
                  {u.message}
                </span>
              ) : null}
              {u.state === "error" && u.retryable ? (
                <button
                  type="button"
                  onClick={() => {
                    const file = files.current.get(u.key);
                    if (file) void upload(u.key, file);
                  }}
                  className="h-7 rounded-[var(--radius-control)] border border-control px-2 text-[12px] font-medium text-ink"
                >
                  Reintentar
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
