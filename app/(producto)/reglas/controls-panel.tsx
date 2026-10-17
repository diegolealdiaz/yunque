"use client";

import { useActionState, useTransition } from "react";

import type { Controls } from "@/src/domain";

import { ActionOutcome } from "../../_components/action-outcome";
import { ControlSwitch } from "../../_components/control-switch";

import { controlsAction } from "./actions";

/**
 * Los tres interruptores de control (docs/interfaz.md §5.4): no son política sino control,
 * van separados del formulario y piden confirmación. Cada cambio queda como versión firmada
 * y en la bitácora; el servidor rechaza a quien no está en la lista de aprobadores.
 */
export function ControlsPanel({
  controls,
  canSign,
}: {
  readonly controls: Controls;
  readonly canSign: boolean;
}) {
  const [state, run] = useActionState(controlsAction, null);
  const [pending, startTransition] = useTransition();
  const disabled = !canSign || pending;
  const change = (control: "payments_enabled" | "dry_run" | "autonomy") => (next: boolean) => {
    const form = new FormData();
    form.set("control", control);
    form.set("value", next ? "on" : "off");
    startTransition(() => run(form));
  };
  return (
    <section aria-label="Interruptores de control" className="space-y-2">
      <div className="grid gap-3 lg:grid-cols-3">
        <ControlSwitch
          key={`pagos-${String(controls.payments_enabled)}`}
          label="Pagos"
          description="Interruptor de emergencia"
          checked={controls.payments_enabled}
          confirmOn="El agente vuelve a pagar lo que cumple las reglas."
          confirmOff="Ninguna factura se pagará: lo que pagaría queda escalado para una persona."
          onChange={change("payments_enabled")}
          disabled={disabled}
        />
        <ControlSwitch
          key={`prueba-${String(controls.dry_run)}`}
          label="Modo de prueba"
          description="Decide sin preparar órdenes"
          checked={controls.dry_run}
          confirmOn="Las decisiones se registran pero no comprometen presupuesto ni saldo."
          confirmOff="Las decisiones de pago vuelven a preparar órdenes y comprometer presupuesto."
          onChange={change("dry_run")}
          disabled={disabled}
        />
        <ControlSwitch
          key={`autonomia-${controls.autonomy}`}
          label="El agente"
          description="Decide o solo recomienda"
          checked={controls.autonomy === "decidir"}
          onLabel="Decide"
          offLabel="Solo recomienda"
          confirmOn="El agente paga y frena solo dentro de las reglas y escala lo demás."
          confirmOff="Toda decisión pasa por una persona; el agente solo recomienda."
          onChange={change("autonomy")}
          disabled={disabled}
        />
      </div>
      {!canSign ? (
        <p className="text-[12px] text-ink-3">
          Elige arriba quién firma para poder cambiar un interruptor.
        </p>
      ) : null}
      <ActionOutcome state={state} />
    </section>
  );
}
