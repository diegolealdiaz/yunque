import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { AlertIcon, CheckIcon, ChevronIcon, LockIcon, StopIcon } from "../_components/icons";
import { ThemeToggle } from "../_components/theme-toggle";

import { MobileMenu } from "./mobile-menu";

/**
 * Secciones de la portada pública (docs/interfaz.md §11). La portada explica qué hace Yunque
 * y por qué es seguro, y lleva a probarlo; el producto empieza en /pendientes. El control va
 * al centro, con piezas reales del producto (bitácora, ver qué cambiaría, interruptor), no
 * con promesas. Todo lo que se afirma aquí lo hace el código hoy. Los atributos `data-*`
 * marcan qué anima app/_landing/motion.tsx; sin animación, el HTML ya es el estado final.
 */

/** La única puerta a la demo: entrar al producto crea la empresa de ejemplo del visitante. */
export const DEMO_HREF = "/pendientes";

function DemoButton({ size = "md" }: { readonly size?: "md" | "lg" }) {
  return (
    <Link
      href={DEMO_HREF}
      data-pop="1.04"
      className={`btn-primary ${size === "lg" ? "h-12 px-6 text-[15px]" : "h-9 px-4 text-[13px]"}`}
    >
      Probar la demo
      <ChevronIcon />
    </Link>
  );
}

function Section({
  id,
  eyebrow,
  title,
  lead,
  children,
}: {
  readonly id?: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly lead?: string;
  readonly children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={id ? `${id}-titulo` : undefined}
      data-reveal
      className="scroll-mt-20"
    >
      <p className="caps text-brand">{eyebrow}</p>
      <h2
        id={id ? `${id}-titulo` : undefined}
        data-reveal-title
        className="mt-3 max-w-3xl text-[30px] leading-[1.15] font-bold tracking-tight text-ink sm:text-[38px]"
      >
        {title}
      </h2>
      {lead ? (
        <p data-reveal-lead className="mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-2">
          {lead}
        </p>
      ) : null}
      <div className="mt-10">{children}</div>
    </section>
  );
}

const NAV_LINKS = [
  { href: "#como-funciona", label: "Cómo funciona" },
  { href: "#control", label: "Control" },
  { href: "#preguntas", label: "Preguntas" },
] as const;

export function LandingNav() {
  return (
    <header className="sticky top-0 z-30 border-b border-line">
      {/*
        El fondo translúcido va en su propia capa: un desenfoque en el encabezado mismo lo
        volvería el marco de los elementos fijos, y el menú del teléfono quedaría encerrado.
      */}
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-paper/80 backdrop-blur-md" />
      <nav
        aria-label="Portada"
        className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6"
      >
        <Link
          href="/"
          data-intro="nav"
          className="relative z-50 flex items-center gap-2.5 text-[17px] font-bold tracking-tight text-ink"
        >
          <Image src="/marca.png" alt="" width={28} height={28} className="rounded-[7px]" />
          Yunque
        </Link>
        <div className="flex items-center gap-1 sm:gap-2">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              data-intro="nav"
              data-pop="1.06"
              className="hidden rounded-[var(--radius-control)] px-3 py-2 text-[13px] text-ink-2 hover:text-ink md:inline-block"
            >
              {link.label}
            </a>
          ))}
          <span data-intro="nav" className="relative z-50">
            <ThemeToggle compact />
          </span>
          <span data-intro="nav" className="hidden sm:inline-flex">
            <DemoButton />
          </span>
          {/* Sin animación de entrada: un ancestro transformado encerraría el panel fijo. */}
          <MobileMenu links={NAV_LINKS} demoHref={DEMO_HREF} />
        </div>
      </nav>
    </header>
  );
}

export function Hero({ preview }: { readonly preview: ReactNode }) {
  return (
    <section
      aria-labelledby="portada-titulo"
      data-hero-scroll
      className="grid items-center gap-12 pt-14 pb-20 lg:grid-cols-[1.05fr_1fr] lg:pt-20"
    >
      <div data-hero-copy>
        <p data-intro="eyebrow" className="caps">
          Agente de cuentas por pagar
        </p>
        <h1
          id="portada-titulo"
          className="mt-4 text-[40px] leading-[1.05] font-bold tracking-tight text-ink sm:text-[56px]"
        >
          {/* Cada línea sube desde abajo de su máscara; el descenso de la «g» cabe en el relleno. */}
          <span className="block overflow-hidden pb-[0.08em]">
            <span data-intro="line" className="block">
              Paga tus facturas
            </span>
          </span>
          <span className="block overflow-hidden pb-[0.12em]">
            <span data-intro="line" className="hero-figure block">
              sin salirte de tus reglas.
            </span>
          </span>
        </h1>
        <p data-intro="lead" className="mt-6 max-w-xl text-[17px] leading-relaxed text-ink-2">
          Yunque lee cada factura, la revisa contra tu política y decide: paga lo que cumple, frena
          lo sospechoso y te pasa solo lo que necesita una persona, con la regla, el valor y el
          umbral a la vista.
        </p>
        <div data-intro="cta" className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
          <DemoButton size="lg" />
          <a
            href="#como-funciona"
            data-pop="1.04"
            className="inline-flex items-center gap-1 text-[14px] font-medium text-ink underline-offset-4 hover:underline"
          >
            Ver cómo decide
            <ChevronIcon />
          </a>
        </div>
        <p data-intro="cta" className="mt-4 text-[13px] text-ink-3">
          Sin registro · datos de ejemplo · ningún pago real
        </p>
      </div>
      {preview}
    </section>
  );
}

const VERDICTS = [
  {
    Icon: CheckIcon,
    tone: "text-pay",
    tint: "bg-pay-tint",
    name: "Pagar",
    body: "Cumple todas tus reglas. El agente prepara la orden sin esperar a nadie.",
    example: "Proveedor conocido, monto dentro del umbral, cuenta de siempre.",
  },
  {
    Icon: StopIcon,
    tone: "text-hold",
    tint: "bg-hold-tint",
    name: "Frenar",
    body: "Algo no debe pagarse. Se detiene y queda escrito por qué.",
    example: "Factura duplicada, instrucciones escondidas en el documento, sin saldo.",
  },
  {
    Icon: AlertIcon,
    tone: "text-escalate",
    tint: "bg-escalate-tint",
    name: "Escalar",
    body: "Necesita criterio humano. Llega a quien aprueba con lo que hay que verificar.",
    example: "Primer pago a un beneficiario, cuenta nueva, monto sobre el umbral.",
  },
] as const;

export function Verdicts() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {VERDICTS.map(({ Icon, tone, tint, name, body, example }) => (
        <article key={name} data-reveal-item className="card card-lift p-6">
          <span
            className={`inline-flex size-10 items-center justify-center rounded-full ${tint} ${tone}`}
          >
            <Icon className="size-5" />
          </span>
          <h3 className={`mt-4 text-[20px] font-bold tracking-tight ${tone}`}>{name}</h3>
          <p className="mt-2 text-[15px] leading-relaxed text-ink">{body}</p>
          <p className="mt-3 text-[13px] leading-relaxed text-ink-3">{example}</p>
        </article>
      ))}
    </div>
  );
}

export function HowItWorks({ ruleCount }: { readonly ruleCount: number }) {
  const steps = [
    {
      n: "01",
      title: "Llega la factura",
      body: "Por el canal que ya usa tu equipo. Si la misma entrega llega dos veces, se procesa una vez; una copia por otro camino se frena como duplicada.",
      chips: ["PDF", "Foto", "Correo", "Telegram"],
    },
    {
      n: "02",
      title: "El agente la revisa",
      body: `La lee y la pasa por ${String(ruleCount)} controles: monto, duplicados, presupuesto, saldo, cuenta, beneficiario. El modelo solo lee; las reglas deciden.`,
      chips: ["Monto", "Duplicados", "Cuenta", "Presupuesto"],
    },
    {
      n: "03",
      title: "Tú decides lo que importa",
      body: "Lo que cumple se paga; lo sospechoso se frena. Lo demás te llega con un checklist de lo que hay que verificar antes de aprobar.",
      chips: ["Checklist", "Firma", "Bitácora"],
    },
  ];
  return (
    <ol data-draw-group className="grid gap-4 md:grid-cols-3">
      {steps.map((step, i) => (
        <li key={step.n} data-reveal-item className="card card-lift relative p-6">
          {/* Conector al paso siguiente, dibujado al llegar: llega, se revisa, decides. */}
          {i < steps.length - 1 ? (
            <span
              aria-hidden="true"
              data-draw
              className="draw-line absolute top-[33px] left-[52px] z-10 hidden h-px w-[calc(100%-20px)] bg-linear-to-r from-brand to-brand/0 md:block"
            />
          ) : null}
          <span className="relative z-20 inline-flex rounded-full bg-surface pr-2 font-mono text-[13px] font-semibold text-brand">
            {step.n}
          </span>
          <h3 className="mt-3 text-[19px] font-bold tracking-tight text-ink">{step.title}</h3>
          <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{step.body}</p>
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
        </li>
      ))}
    </ol>
  );
}

const AUDIT = [
  { at: "09:12:04", what: "Recibida", detail: "correo" },
  { at: "09:12:06", what: "Leída", detail: "1,8 s" },
  { at: "09:12:06", what: "Escalada", detail: "bank_account_mismatch" },
  { at: "09:31:40", what: "Aprobada", detail: "Ana Torres" },
] as const;

const NEVER = [
  "Pagar por encima del tope absoluto del sistema, ni aunque la política lo permita.",
  "Pagar a una cuenta distinta de la registrada sin que una persona lo confirme.",
  "Seguir instrucciones escritas dentro de una factura.",
  "Ejecutar el pago: deja la orden preparada en el formato de tu plataforma.",
] as const;

export function Control() {
  return (
    <div className="grid gap-4 lg:grid-cols-6">
      <article data-reveal-item className="card card-lift min-w-0 p-6 lg:col-span-3">
        <h3 className="text-[18px] font-bold tracking-tight text-ink">
          Cada decisión, con su regla
        </h3>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
          Qué leyó, qué control falló, con qué valor y contra qué umbral. La bitácora solo se
          agrega: nada se edita ni se borra.
        </p>
        <ul className="mt-5 divide-y divide-line rounded-[12px] border border-line bg-surface-sunken font-mono text-[12px]">
          {AUDIT.map((row) => (
            <li key={`${row.at}-${row.what}`} className="flex items-center gap-4 px-4 py-2.5">
              <span className="text-ink-3">{row.at}</span>
              <span className="w-20 font-semibold text-ink">{row.what}</span>
              <span className="truncate text-ink-2">{row.detail}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 flex items-center gap-1.5 text-[12px] text-ink-3">
          <LockIcon /> Solo se agrega
        </p>
      </article>

      <article data-reveal-item className="card card-lift min-w-0 p-6 lg:col-span-3">
        <h3 className="text-[18px] font-bold tracking-tight text-ink">
          Ve qué cambiaría antes de guardar
        </h3>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
          Cambiar una regla reevalúa las facturas que ya pasaron. Ves el efecto, y una persona
          aprobadora firma la versión nueva.
        </p>
        <div className="mt-5 rounded-[12px] border border-line bg-surface-sunken p-4">
          <p className="flex items-center justify-between text-[13px]">
            <span className="text-ink-2">Umbral de aprobación</span>
            <span className="num font-mono text-ink">
              <span className="text-ink-3 line-through">5,000.00</span> → 2,000.00 USD
            </span>
          </p>
          <div className="mt-4 space-y-2 text-[13px]">
            <p className="flex items-center justify-between rounded-[8px] bg-escalate-tint px-3 py-2">
              <span className="text-ink">3 facturas</span>
              <span className="font-semibold text-escalate">Pagar → Escalar</span>
            </p>
            <p className="flex items-center justify-between rounded-[8px] bg-surface px-3 py-2">
              <span className="text-ink">26 facturas</span>
              <span className="text-ink-3">sin cambio</span>
            </p>
          </div>
        </div>
      </article>

      <article data-reveal-item className="card card-lift min-w-0 p-6 lg:col-span-2">
        <h3 className="text-[18px] font-bold tracking-tight text-ink">Interruptor de emergencia</h3>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
          Un clic apaga los pagos. El agente sigue leyendo y avisando, pero nada se paga.
        </p>
        <div className="mt-5 flex items-center justify-between rounded-[12px] border border-line bg-surface-sunken px-4 py-3 text-[13px]">
          <span className="text-ink">Pagos</span>
          <span className="inline-flex items-center gap-2 rounded-full border border-line-strong px-2 py-1">
            <span className="size-4 rounded-full bg-ink" />
            <span className="pr-1 font-medium text-ink">Encendidos</span>
          </span>
        </div>
      </article>

      <article data-reveal-item className="card card-lift min-w-0 p-6 lg:col-span-2">
        <h3 className="text-[18px] font-bold tracking-tight text-ink">Aprobar es un acto</h3>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
          El botón se habilita cuando marcas lo que verificaste. Lo que firmas queda escrito.
        </p>
        <ul className="mt-5 space-y-2 text-[13px]">
          <li className="flex gap-2.5">
            <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] bg-brand text-on-brand">
              <CheckIcon className="size-3" />
            </span>
            <span className="text-ink">Confirmé la cuenta con el beneficiario</span>
          </li>
          <li className="flex gap-2.5">
            <span className="mt-0.5 size-4 shrink-0 rounded-[4px] border border-control" />
            <span className="text-ink-2">Revisé el monto en el documento</span>
          </li>
        </ul>
      </article>

      <article data-reveal-item className="card card-lift min-w-0 p-6 lg:col-span-2">
        <h3 className="text-[18px] font-bold tracking-tight text-ink">Lo que Yunque nunca hace</h3>
        <ul className="mt-4 space-y-3 text-[13px] leading-relaxed">
          {NEVER.map((line) => (
            <li key={line} className="flex gap-2.5 text-ink-2">
              <span className="mt-0.5 shrink-0 text-hold-solid">
                <StopIcon />
              </span>
              {line}
            </li>
          ))}
        </ul>
      </article>
    </div>
  );
}

export function Proof({
  ruleCount,
  sampleCount,
}: {
  readonly ruleCount: number;
  readonly sampleCount: number;
}) {
  const stats = [
    { value: String(ruleCount), label: "controles por factura" },
    { value: String(sampleCount), label: "casos de ejemplo para probarlo" },
    { value: "4", label: "canales de entrada: PDF, foto, correo y Telegram" },
  ];
  return (
    <div
      data-reveal-item
      className="card grid gap-8 p-8 md:grid-cols-[1.3fr_1fr_1fr_1fr] md:items-end"
    >
      <div>
        <p className="hero-figure num font-mono text-[72px] leading-none font-bold tracking-tight">
          0
        </p>
        <p className="mt-3 text-[14px] leading-relaxed text-ink-2">
          pagos indebidos en el set de regresión. Si aparece uno, la integración continua falla y el
          cambio no entra.
        </p>
      </div>
      {stats.map((stat) => (
        <div key={stat.label}>
          <p
            data-count-to={stat.value}
            className="num font-mono text-[40px] leading-none font-semibold tracking-tight text-ink"
          >
            {stat.value}
          </p>
          <p className="mt-3 text-[13px] leading-relaxed text-ink-3">{stat.label}</p>
        </div>
      ))}
    </div>
  );
}

const FAQ = [
  {
    q: "¿La demo paga de verdad?",
    a: "No. Todo es de ejemplo: empresas, beneficiarios y facturas ficticias. Aun en uso real, Yunque deja la orden de pago preparada, no ejecutada, en el formato de tu plataforma.",
  },
  {
    q: "¿Qué pasa si la IA lee mal una factura?",
    a: "El modelo solo lee y redacta; nunca decide. Cada campo trae su cita en el documento y su confianza. Si un dato es ambiguo o no cuadra, la factura se escala a una persona en lugar de pagarse.",
  },
  {
    q: "¿Quién puede cambiar las reglas?",
    a: "Solo las personas aprobadoras de la política. Cada cambio es una versión firmada y, antes de guardarla, se ve qué facturas cambiarían de veredicto.",
  },
  {
    q: "¿Puedo probar con mi propia factura?",
    a: "Sí. En la demo, «Probar con tu factura» te da una dirección de correo y un bot de Telegram con el código de acceso que te compartimos. Usa facturas de ejemplo o sin datos sensibles.",
  },
  {
    q: "¿Qué queda registrado?",
    a: "Todo: la entrega, la lectura, cada control con su valor y su umbral, la decisión, quién aprobó o rechazó y por qué. La bitácora no se edita ni se borra.",
  },
] as const;

export function Faq() {
  return (
    <div data-reveal-item className="card divide-y divide-line">
      {FAQ.map((item) => (
        <details key={item.q} className="group px-6 py-5">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-semibold text-ink">
            {item.q}
            <span className="shrink-0 text-ink-3 transition-transform group-open:rotate-90">
              <ChevronIcon />
            </span>
          </summary>
          <p className="mt-3 max-w-3xl text-[14px] leading-relaxed text-ink-2">{item.a}</p>
        </details>
      ))}
    </div>
  );
}

export function FinalCall({ sampleCount }: { readonly sampleCount: number }) {
  return (
    <section
      aria-labelledby="cierre-titulo"
      data-reveal
      className="card relative overflow-hidden px-6 py-14 text-center sm:px-12"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(ellipse_60%_80%_at_50%_0%,var(--glow-1),transparent)]"
      />
      <div className="relative">
        <h2
          id="cierre-titulo"
          data-reveal-title
          className="mx-auto max-w-2xl text-[30px] leading-[1.15] font-bold tracking-tight text-ink sm:text-[40px]"
        >
          Mira al agente decidir {sampleCount} facturas en un minuto.
        </h2>
        <p
          data-reveal-lead
          className="mx-auto mt-4 max-w-xl text-[16px] leading-relaxed text-ink-2"
        >
          Procesa el lote de ejemplo, abre una escalada y apruébala tú. Cambia una regla y mira qué
          cambiaría.
        </p>
        <div data-reveal-item className="mt-8 flex justify-center">
          <DemoButton size="lg" />
        </div>
        <p className="mt-4 text-[13px] text-ink-3">
          Sin registro · datos de ejemplo · ningún pago real
        </p>
      </div>
    </section>
  );
}

export function LandingFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-8 text-[13px] text-ink-3 sm:px-6">
        <span className="flex items-center gap-2">
          <Image src="/marca.png" alt="" width={20} height={20} className="rounded-[5px]" />
          Yunque · hecho por Forja
        </span>
        <span>El agente que paga sin salirse de las reglas.</span>
      </div>
    </footer>
  );
}

export { Section };
