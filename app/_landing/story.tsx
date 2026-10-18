import type { ReactNode } from "react";

import type { Verdict } from "@/src/domain";

import { AlertIcon, CheckIcon, StopIcon } from "../_components/icons";

import { Eyebrow } from "./sections";

/**
 * El relato de la portada, entre el primer bloque y el producto: el problema y cómo lo
 * resuelve Yunque. app/_landing/motion.tsx ilumina el problema palabra por palabra al bajar
 * y, en escritorio, deja fija la ilustración de "Cómo funciona" y la cambia según el paso que
 * se lee. Sin animación, el texto está entero y cada paso trae su ilustración debajo.
 */

const PAINS = [
  {
    title: "Todo pasa por las mismas manos",
    body: "La factura que cumple espera en la misma fila que la sospechosa.",
  },
  {
    title: "Un PDF basta para desviar un pago",
    body: "Una cuenta cambiada se ve igual que la de siempre.",
  },
  {
    title: "Nadie puede mostrar por qué",
    body: "Cuando preguntan por qué se pagó, la respuesta está perdida entre correos y chats.",
  },
] as const;

export function Problem() {
  return (
    <section aria-labelledby="problema-titulo" data-problem className="scroll-mt-20 text-center">
      <Eyebrow>El problema</Eyebrow>
      <h2
        id="problema-titulo"
        data-problem-text
        className="mx-auto mt-6 max-w-5xl text-[30px] leading-[1.15] font-bold tracking-[-0.02em] text-ink sm:text-[50px]"
      >
        Hoy, pagar una factura es confiar en que alguien la miró bien. Y cuando todo se revisa a
        mano, lo urgente tapa lo sospechoso.
      </h2>
      <ul
        data-reveal
        className="mt-14 grid gap-px text-left overflow-hidden rounded-[var(--radius-card)] border border-line bg-line md:grid-cols-3"
      >
        {PAINS.map((pain, i) => (
          <li key={pain.title} data-reveal-item className="bg-paper p-6">
            <span className="font-mono text-[12px] text-ink-3">0{i + 1}</span>
            <h3 className="mt-2 text-[17px] font-bold tracking-tight text-ink">{pain.title}</h3>
            <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{pain.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

type Step = {
  readonly n: string;
  /** Nombre corto en la pestaña. */
  readonly tab: string;
  readonly title: string;
  readonly body: string;
  readonly chips: readonly string[];
};

export function HowItWorks({
  ruleCount,
  counts,
}: {
  readonly ruleCount: number;
  readonly counts: Readonly<Record<Verdict, number>> | null;
}) {
  const steps: readonly Step[] = [
    {
      n: "01",
      tab: "Recibe",
      title: "Llega la factura",
      body: "Por el canal que ya usa tu equipo. Si la misma entrega llega dos veces, se procesa una vez; una copia por otro camino se frena como duplicada.",
      chips: ["PDF", "Foto", "Correo", "Telegram"],
    },
    {
      n: "02",
      tab: "Lee y revisa",
      title: "El agente la lee y la revisa",
      body: `Cada dato con su cita en el documento y su confianza. Después, ${String(ruleCount)} controles: monto, duplicados, presupuesto, saldo, cuenta y beneficiario. El modelo solo lee; las reglas deciden.`,
      chips: ["Cita", "Confianza", `${String(ruleCount)} controles`],
    },
    {
      n: "03",
      tab: "Decide",
      title: "Tú decides solo lo que importa",
      body: "Lo que cumple se paga y lo sospechoso se frena, con su motivo. Lo demás te llega con un checklist de lo que hay que verificar antes de aprobar.",
      chips: ["Pagar", "Frenar", "Escalar"],
    },
  ];
  const visuals = [
    <Arrival key="llega" />,
    <Reading key="lee" ruleCount={ruleCount} />,
    <Outcome key="decide" counts={counts} />,
  ];
  return (
    <div data-story className="relative">
      {/*
        Pestañas fijas en escritorio: marcan el paso que se lee y llevan a cualquiera de los
        tres. Las enciende motion.tsx; sin animación son enlaces a cada paso.
      */}
      <nav aria-label="Pasos" className="sticky top-20 z-20 mb-4 hidden justify-center lg:flex">
        <ol className="flex gap-1 rounded-full border border-line bg-surface/85 p-1 shadow-[var(--shadow-card)] backdrop-blur-md">
          {steps.map((step, i) => (
            <li key={step.n}>
              <a
                href={`#paso-${String(i + 1)}`}
                data-story-tab
                className="story-tab flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-medium text-ink-2 hover:text-ink"
              >
                <span className="font-mono text-[11px] text-ink-3">{step.n}</span>
                {step.tab}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <div className="grid gap-12 lg:grid-cols-[1fr_1.05fr] lg:gap-16">
        <ol className="relative space-y-14 lg:space-y-0">
          {/* Línea de avance: se llena al bajar por los tres pasos. */}
          <span
            aria-hidden="true"
            className="absolute top-2 bottom-2 left-[15px] hidden w-px bg-line lg:block"
          >
            <span data-story-progress className="block h-full w-full origin-top bg-brand" />
          </span>
          {steps.map((step, i) => (
            <li
              key={step.n}
              id={`paso-${String(i + 1)}`}
              data-story-step
              className="relative scroll-mt-32 lg:flex lg:min-h-[72vh] lg:items-center lg:pl-14"
            >
              <div>
                <span className="relative z-10 inline-flex size-8 items-center justify-center rounded-full border border-line-strong bg-paper font-mono text-[12px] font-semibold text-brand lg:absolute lg:top-1/2 lg:left-0 lg:-translate-y-1/2">
                  {step.n}
                </span>
                <h3 className="mt-4 text-[24px] font-bold tracking-tight text-ink lg:mt-0 lg:text-[30px]">
                  {step.title}
                </h3>
                <p className="mt-3 max-w-md text-[15px] leading-relaxed text-ink-2">{step.body}</p>
                <ul className="mt-5 flex flex-wrap gap-1.5">
                  {step.chips.map((chip) => (
                    <li
                      key={chip}
                      className="rounded-full bg-surface-hover px-2.5 py-1 text-[12px] font-medium text-ink-2"
                    >
                      {chip}
                    </li>
                  ))}
                </ul>
                {/* En el teléfono y la tableta, la ilustración va con su paso. */}
                <div className="mt-8 lg:hidden">{visuals[i]}</div>
              </div>
            </li>
          ))}
        </ol>
        <div aria-hidden="true" className="hidden lg:block">
          <div className="sticky top-[calc(50vh-13rem)] grid">
            {visuals.map((visual, i) => (
              <div
                key={steps[i]?.n}
                data-story-visual
                className={`[grid-area:1/1] ${i === 0 ? "" : "invisible"}`}
              >
                {visual}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Frame({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="card overflow-hidden">
      <div className="flex h-9 items-center gap-2 border-b border-line bg-shell px-4">
        <span className="size-2.5 rounded-full bg-line-strong" />
        <span className="size-2.5 rounded-full bg-line-strong" />
        <span className="size-2.5 rounded-full bg-line-strong" />
        <span className="ml-3 font-mono text-[11px] text-ink-3">{label}</span>
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

/** Renglones de un documento, sin texto: la forma de una factura. */
function DocLines({ widths }: { readonly widths: readonly string[] }) {
  return (
    <div className="space-y-2">
      {widths.map((w, i) => (
        <span key={`${w}-${String(i)}`} className={`block h-2 rounded-full bg-line ${w}`} />
      ))}
    </div>
  );
}

const CHANNELS = [
  { name: "Correo", detail: "facturas@tuempresa" },
  { name: "Telegram", detail: "foto desde el teléfono" },
  { name: "PDF", detail: "subida o lote" },
] as const;

function Arrival() {
  return (
    <Frame label="yunque · recepción">
      <div className="grid gap-5 sm:grid-cols-[1fr_1.1fr] sm:items-center">
        <ul className="space-y-2">
          {CHANNELS.map((channel) => (
            <li
              key={channel.name}
              className="flex items-center justify-between gap-3 rounded-[10px] border border-line bg-surface-sunken px-3 py-2.5 text-[13px]"
            >
              <span className="font-semibold text-ink">{channel.name}</span>
              <span className="truncate text-[12px] text-ink-3">{channel.detail}</span>
            </li>
          ))}
        </ul>
        <div className="rounded-[12px] border border-line bg-surface-sunken p-4">
          <p className="caps">Factura · F-2291</p>
          <p className="mt-1.5 text-[15px] font-semibold text-ink">Nube Andina SAS</p>
          <div className="mt-4">
            <DocLines widths={["w-full", "w-5/6", "w-2/3", "w-3/4"]} />
          </div>
          <p className="mt-4 flex items-center justify-between border-t border-line pt-3 text-[13px]">
            <span className="text-ink-3">Total</span>
            <span className="num font-mono font-semibold text-ink">4.800.000 COP</span>
          </p>
        </div>
      </div>
      <p className="mt-5 flex items-center gap-2 rounded-[10px] bg-brand-tint px-3 py-2 text-[12px] text-ink">
        <CheckIcon className="size-4 text-brand" />
        Recibida una vez, aunque llegue dos.
      </p>
    </Frame>
  );
}

const FIELDS = [
  { label: "Beneficiario", value: "Nube Andina SAS", confidence: "0.98" },
  { label: "Número", value: "F-2291", confidence: "0.99" },
  { label: "Total", value: "4.800.000 COP", confidence: "0.97" },
  { label: "Cuenta", value: "****9023", confidence: "0.96" },
] as const;

function Reading({ ruleCount }: { readonly ruleCount: number }) {
  return (
    <Frame label="yunque · lectura">
      <ul className="space-y-2">
        {FIELDS.map((field) => (
          <li
            key={field.label}
            className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-[10px] border border-line bg-surface-sunken px-3 py-2.5 text-[13px]"
          >
            <span className="text-ink-3">{field.label}</span>
            <span className="truncate font-mono text-ink">{field.value}</span>
            <span className="flex items-center gap-1.5 font-mono text-[12px] text-ink-3">
              <span className="size-2 rounded-full bg-pay-solid" />
              {field.confidence}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-5 rounded-[10px] border border-line px-4 py-3">
        <p className="flex items-center justify-between text-[13px]">
          <span className="font-semibold text-ink">{ruleCount} controles</span>
          <span className="font-mono text-[12px] text-pay">pasaron los que aplican</span>
        </p>
        <span className="mt-3 block h-1.5 overflow-hidden rounded-full bg-line">
          <span className="block h-full w-full rounded-full bg-linear-to-r from-brand-grad-start to-brand-grad-end" />
        </span>
      </div>
    </Frame>
  );
}

const OUTCOMES = [
  {
    verdict: "pagar",
    Icon: CheckIcon,
    tone: "text-pay",
    tint: "bg-pay-tint",
    title: "Se pagan sin esperar a nadie",
  },
  {
    verdict: "frenar",
    Icon: StopIcon,
    tone: "text-hold",
    tint: "bg-hold-tint",
    title: "Se frenan, con su motivo",
  },
  {
    verdict: "escalar",
    Icon: AlertIcon,
    tone: "text-escalate",
    tint: "bg-escalate-tint",
    title: "Te llegan a ti, con un checklist",
  },
] as const;

function Outcome({ counts }: { readonly counts: Readonly<Record<Verdict, number>> | null }) {
  return (
    <Frame label="yunque · decisiones del lote de ejemplo">
      <ul className="space-y-2">
        {OUTCOMES.map(({ verdict, Icon, tone, tint, title }) => (
          <li
            key={verdict}
            className={`flex items-center gap-3 rounded-[10px] px-4 py-3 text-[14px] ${tint}`}
          >
            <Icon className={`size-5 shrink-0 ${tone}`} />
            <span className="flex-1 text-ink">{title}</span>
            {counts ? (
              <span className={`num font-mono text-[20px] font-bold ${tone}`}>
                {counts[verdict]}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="mt-5 rounded-[10px] border border-line p-4 text-[13px]">
        <p className="font-semibold text-ink">Para aprobar, marca:</p>
        <p className="mt-2 flex gap-2.5">
          <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] bg-brand text-on-brand">
            <CheckIcon className="size-3" />
          </span>
          <span className="text-ink">Confirmé el monto con el documento</span>
        </p>
        <p className="mt-2 flex gap-2.5">
          <span className="mt-0.5 size-4 shrink-0 rounded-[4px] border border-control" />
          <span className="text-ink-2">Confirmé la cuenta con el beneficiario</span>
        </p>
      </div>
    </Frame>
  );
}
