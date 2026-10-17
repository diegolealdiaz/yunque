"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type DragEvent } from "react";

import { VerdictChip } from "../../_components/verdict-chip";

import { ProcessResponseSchema, errorMessage, type ProcessResponse } from "./api-responses";

/**
 * Subida en pantalla (docs/arquitectura.md §5): arrastrar o elegir PDF, imagen o correo en
 * JSON. Cada archivo elegido recibe su llave de entrega en el navegador, así un reintento no
 * duplica la factura. El tipo se valida aquí para avisar rápido, y de verdad en el servidor,
 * por contenido.
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
};

export function UploadPanel({ maxBytes }: { readonly maxBytes: number }) {
  const router = useRouter();
  const inputId = useId();
  const [uploads, setUploads] = useState<readonly Upload[]>([]);
  const [dragging, setDragging] = useState(false);

  const update = (key: string, patch: Partial<Upload>) =>
    setUploads((all) => all.map((u) => (u.key === key ? { ...u, ...patch } : u)));

  async function send(file: File) {
    const key = `upload:${crypto.randomUUID()}`;
    setUploads((all) => [{ key, name: file.name, state: "subiendo" }, ...all]);
    if (file.size > maxBytes) {
      update(key, {
        state: "error",
        message: "El archivo supera el tamaño máximo. Sube uno más liviano.",
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
      update(key, { state: "error", message: "Sin conexión. Vuelve a intentarlo." });
    }
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    for (const file of Array.from(event.dataTransfer.files)) void send(file);
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
        className={`block cursor-pointer rounded-[var(--radius-card)] border border-dashed px-6 py-6 text-center text-[13px] ${dragging ? "border-ink bg-surface-hover" : "border-line-strong bg-surface"}`}
      >
        <span className="block font-medium text-ink">Arrastra facturas aquí o elige archivos</span>
        <span className="mt-1 block text-ink-2">
          PDF, PNG, JPG o correo en JSON · hasta {Math.round(maxBytes / 1024 / 1024)} MB
        </span>
        <input
          id={inputId}
          type="file"
          multiple
          accept={ACCEPT}
          aria-label="Elegir facturas para subir"
          className="sr-only"
          onChange={(e) => {
            for (const file of Array.from(e.target.files ?? [])) void send(file);
            e.target.value = "";
          }}
        />
      </label>
      {uploads.length > 0 ? (
        <ul
          aria-live="polite"
          className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface text-[13px]"
        >
          {uploads.map((u) => (
            <li key={u.key} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-ink">{u.name}</span>
              {u.state === "subiendo" ? <VerdictChip verdict="en_proceso" /> : null}
              {u.state === "listo" && u.verdict ? <VerdictChip verdict={u.verdict} /> : null}
              {u.state === "listo" && u.invoiceId ? (
                <Link
                  href={`/facturas/${u.invoiceId}`}
                  className="font-medium text-ink underline underline-offset-4"
                >
                  {u.reference ?? "ver"}
                </Link>
              ) : null}
              {u.state === "error" ? (
                <span role="alert" className="text-hold">
                  {u.message}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
