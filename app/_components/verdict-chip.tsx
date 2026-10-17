"use client";

import { useEffect, useId, useState } from "react";

import type { FindingCode, Verdict } from "@/src/domain";
import { RULE_SHORT_LABEL, VERDICT_LABEL } from "@/src/ui/labels";

import { AlertIcon, CheckIcon, ClockIcon, StopIcon } from "./icons";

/**
 * Chip de veredicto con su regla al lado (principio 2 de docs/interfaz.md). El color nunca
 * va solo: icono y texto dicen lo mismo. Al pasar el ratón o con el foco del teclado
 * aparece el detalle: código de la regla, valor observado, umbral y versión de política.
 * Esc lo cierra sin mover el ratón ni el foco (WCAG 1.4.13); vuelve al salir y entrar.
 */

/** Detalle que se abre al pasar el ratón o con el foco y que Esc cierra. */
function useDismissable() {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDismissed(true);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);
  const enter = () => {
    setOpen(true);
    setDismissed(false);
  };
  const leave = () => {
    setOpen(false);
    setDismissed(false);
  };
  return {
    handlers: { onMouseEnter: enter, onMouseLeave: leave, onFocus: enter, onBlur: leave },
    hidden: dismissed ? "!hidden" : "",
  };
}

export type ChipVerdict = Verdict | "en_proceso";

const STYLE: Readonly<Record<ChipVerdict, { className: string; Icon: typeof CheckIcon }>> = {
  pagar: { className: "bg-pay-tint text-pay", Icon: CheckIcon },
  escalar: { className: "bg-escalate-tint text-escalate", Icon: AlertIcon },
  frenar: { className: "bg-hold-tint text-hold", Icon: StopIcon },
  en_proceso: { className: "bg-pending-tint text-pending", Icon: ClockIcon },
};

export type ChipRule = {
  readonly code: FindingCode;
  readonly observed: string;
  readonly threshold: string;
};

export function VerdictChip({
  verdict,
  rule = null,
  policyVersion = null,
  focusable = false,
}: {
  readonly verdict: ChipVerdict;
  readonly rule?: ChipRule | null;
  readonly policyVersion?: number | null;
  /**
   * Solo donde el chip está solo (el encabezado del detalle). Dentro de una tabla o de un
   * enlace no es una parada de tabulación: la fila ya lo es, y el detalle de la regla va
   * como texto para lectores de pantalla.
   */
  readonly focusable?: boolean;
}) {
  const tooltipId = useId();
  const tooltip = useDismissable();
  const { className, Icon } = STYLE[verdict];
  const label = verdict === "en_proceso" ? "EN PROCESO" : VERDICT_LABEL[verdict];
  const chip = (
    <span
      className={`inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium whitespace-nowrap ${className}`}
    >
      <Icon className="shrink-0" />
      <span className="font-semibold tracking-wide">{label}</span>
      {rule ? <span className="font-normal">· {RULE_SHORT_LABEL[rule.code]}</span> : null}
    </span>
  );
  if (!rule) return chip;
  const detail = (
    <>
      <span className="block font-mono text-ink">{rule.code}</span>
      <span className="block">observado: {rule.observed}</span>
      <span className="block">umbral: {rule.threshold}</span>
      {policyVersion !== null ? <span className="block">política v{policyVersion}</span> : null}
    </>
  );
  if (!focusable) {
    return (
      <span className="group relative inline-flex" {...tooltip.handlers}>
        {chip}
        <span className="sr-only">
          {" "}
          · observado {rule.observed}, umbral {rule.threshold}
        </span>
        <span
          aria-hidden="true"
          className={`absolute top-full left-0 z-20 mt-1 hidden w-max max-w-xs rounded-[var(--radius-control)] border border-line bg-surface p-2 text-[12px] text-ink-2 shadow-sm group-hover:block ${tooltip.hidden}`}
        >
          {detail}
        </span>
      </span>
    );
  }
  return (
    <span className="group relative inline-flex" {...tooltip.handlers}>
      <span tabIndex={0} aria-describedby={tooltipId} className="inline-flex rounded-full">
        {chip}
      </span>
      <span
        role="tooltip"
        id={tooltipId}
        className={`absolute top-full left-0 z-20 mt-1 hidden w-max max-w-xs rounded-[var(--radius-control)] border border-line bg-surface p-2 text-[12px] text-ink-2 shadow-sm group-focus-within:block group-hover:block ${tooltip.hidden}`}
      >
        {detail}
      </span>
    </span>
  );
}
