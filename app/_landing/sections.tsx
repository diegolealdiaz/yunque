import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { CheckIcon, ChevronIcon, LockIcon, StopIcon } from "../_components/icons";
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

/** La etiqueta de cada sección: una píldora con el punto de marca. */
export function Eyebrow({ children }: { readonly children: ReactNode }) {
  return (
    <p className="caps inline-flex items-center gap-2 rounded-full border border-line bg-surface/60 px-3 py-1 text-brand">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-brand" />
      {children}
    </p>
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
      className="scroll-mt-20 text-center"
    >
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2
        id={id ? `${id}-titulo` : undefined}
        data-reveal-title
        className="mx-auto mt-5 max-w-3xl text-[30px] leading-[1.12] font-bold tracking-tight text-ink sm:text-[44px]"
      >
        {title}
      </h2>
      {lead ? (
        <p
          data-reveal-lead
          className="mx-auto mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-2"
        >
          {lead}
        </p>
      ) : null}
      <div className="mt-12 text-left">{children}</div>
    </section>
  );
}

/** Franja de aviso sobre la barra: la demo está abierta, con su enlace. */
export function Announcement({ sampleCount }: { readonly sampleCount: number }) {
  return (
    <div className="border-b border-line bg-shell text-[13px]">
      <Link
        href={DEMO_HREF}
        className="mx-auto flex max-w-6xl items-center justify-center gap-2 px-4 py-2 text-ink-2 hover:text-ink sm:px-6"
      >
        <span className="shrink-0 rounded-full bg-brand-tint px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-brand">
          Demo abierta
        </span>
        <span className="truncate">
          {sampleCount > 0
            ? `${String(sampleCount)} facturas de ejemplo listas para decidir`
            : "Facturas de ejemplo listas para decidir"}
        </span>
        <ChevronIcon />
      </Link>
    </div>
  );
}

const NAV_LINKS = [
  { href: "#como-funciona", label: "Cómo funciona" },
  { href: "#control", label: "Control" },
  { href: "#preguntas", label: "Preguntas" },
] as const;

export function LandingNav() {
  return (
    <header
      data-nav
      className="sticky top-0 z-30 border-b border-line transition-[border-color] duration-300"
    >
      {/*
        El fondo translúcido va en su propia capa: un desenfoque en el encabezado mismo lo
        volvería el marco de los elementos fijos, y el menú del teléfono quedaría encerrado.
      */}
      <div
        aria-hidden="true"
        data-nav-bg
        className="absolute inset-0 -z-10 bg-paper/75 backdrop-blur-md transition-opacity duration-300"
      />
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

/**
 * Fondo del primer bloque, de borde a borde: una rejilla fina que se desvanece hacia los lados
 * y dos luces de marca que se mueven despacio (motion.tsx). Decorativo.
 */
function HeroBackdrop() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute -top-16 bottom-0 left-1/2 -z-10 -ml-[50vw] w-screen overflow-hidden"
    >
      <div className="hero-grid absolute inset-0" />
      <div data-aurora className="aurora aurora-1" />
      <div data-aurora className="aurora aurora-2" />
    </div>
  );
}

export function Hero() {
  return (
    <section
      aria-labelledby="portada-titulo"
      data-hero-scroll
      className="relative flex flex-col items-center pt-16 pb-14 text-center sm:pt-24 sm:pb-16"
    >
      <HeroBackdrop />
      <div data-hero-copy className="flex flex-col items-center">
        <div data-intro="eyebrow">
          <Eyebrow>Agente de cuentas por pagar</Eyebrow>
        </div>
        <h1
          id="portada-titulo"
          className="mt-6 max-w-4xl text-[42px] leading-[1.03] font-bold tracking-[-0.03em] text-ink sm:text-[68px]"
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
        <p
          data-intro="lead"
          className="mt-6 max-w-2xl text-[17px] leading-relaxed text-ink-2 sm:text-[19px]"
        >
          Yunque lee cada factura, la revisa contra tu política y decide: paga lo que cumple, frena
          lo sospechoso y te pasa solo lo que necesita una persona, con la regla a la vista.
        </p>
        <div
          data-intro="cta"
          className="mt-9 flex flex-wrap items-center justify-center gap-x-6 gap-y-3"
        >
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
    </section>
  );
}

const CHANNELS = [
  {
    name: "PDF o foto",
    title: "Súbela desde la pantalla.",
    body: "Arrastra el PDF o la foto de la factura, o procesa de una vez el lote del periodo. El agente lee la página aunque no tenga capa de texto.",
    sample: [
      ["Archivo", "AH-5560.pdf"],
      ["Lectura", "cada campo con su cita"],
      ["Lote", "33 facturas del periodo"],
    ],
  },
  {
    name: "Correo",
    title: "Reenvía la factura y listo.",
    body: "Cada empresa tiene su dirección. El agente lee el adjunto o el cuerpo del correo, y una misma entrega nunca se procesa dos veces.",
    sample: [
      ["De", "facturacion@nubeandina.example"],
      ["Asunto", "Factura F-2291 · octubre"],
      ["Adjunto", "F-2291.pdf"],
    ],
  },
  {
    name: "Telegram",
    title: "Una foto desde el teléfono.",
    body: "Manda la factura al bot de tu empresa y recibe en el mismo chat el aviso de cada decisión importante, con su motivo.",
    sample: [
      ["Tú", "foto · factura-andes.jpg"],
      ["Yunque", "Escalada: supera el umbral"],
      ["Yunque", "Revísala en Pendientes"],
    ],
  },
] as const;

/** Dónde vive el agente: dos tarjetas lado a lado, cada una con un ejemplo de su canal. */
export function Channels() {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {CHANNELS.map((channel) => (
        <article key={channel.name} data-reveal-item className="card card-lift spotlight p-7">
          <p className="caps text-brand">{channel.name}</p>
          <h3 className="mt-3 text-[22px] font-bold tracking-tight text-ink">{channel.title}</h3>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{channel.body}</p>
          <dl className="mt-6 divide-y divide-line rounded-[12px] border border-line bg-surface-sunken text-[13px]">
            {channel.sample.map(([label, value]) => (
              <div key={`${label}-${value}`} className="flex items-center gap-4 px-4 py-2.5">
                <dt className="w-16 shrink-0 text-ink-3">{label}</dt>
                <dd className="truncate font-mono text-[12px] text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        </article>
      ))}
    </div>
  );
}

const WHY = [
  {
    title: "Rápido donde no hace falta criterio",
    body: "Lo que cumple se paga sin esperar a nadie. Tu equipo mira solo las facturas que de verdad lo necesitan.",
  },
  {
    title: "Explicable de punta a punta",
    body: "Cada decisión dice qué regla aplicó, con qué valor y contra qué umbral, en palabras que entiende cualquiera.",
  },
  {
    title: "Seguro por diseño",
    body: "El modelo solo lee; las reglas deciden. Lo que diga el documento puede endurecer un veredicto, nunca ablandarlo.",
  },
  {
    title: "Tus reglas, tu firma",
    body: "La política es tuya, por versiones y firmada. Antes de guardar un cambio ves qué facturas cambiarían.",
  },
] as const;

/** Por qué Yunque: cuatro bloques de solo texto, como un cierre de argumento. */
export function Why() {
  return (
    <div>
      <div className="grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
        {WHY.map((item) => (
          <div key={item.title} data-reveal-item className="border-t border-line-strong pt-5">
            <h3 className="text-[18px] font-bold tracking-tight text-ink">{item.title}</h3>
            <p className="mt-3 text-[14px] leading-relaxed text-ink-2">{item.body}</p>
          </div>
        ))}
      </div>
      <div data-reveal-item className="mt-12 flex justify-center">
        <DemoButton size="lg" />
      </div>
    </div>
  );
}

const AUDIT = [
  { at: "09:12:04", what: "Recibida", detail: "correo" },
  { at: "09:12:06", what: "Leída", detail: "con cita y confianza" },
  { at: "09:12:06", what: "Escalada", detail: "payee_not_allowed" },
  { at: "09:31:40", what: "Aprobada", detail: "Ana Torres" },
] as const;

const NEVER = [
  "Pagar por encima del tope absoluto del sistema, ni aunque la política lo permita.",
  "Pagar a una cuenta distinta de la registrada: esa factura se frena.",
  "Seguir instrucciones escritas dentro de una factura.",
  "Ejecutar el pago: deja la orden preparada en el formato de tu plataforma.",
] as const;

export function Control() {
  return (
    <div className="grid gap-4 lg:grid-cols-6">
      <article data-reveal-item className="card card-lift spotlight min-w-0 p-6 lg:col-span-3">
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

      <article data-reveal-item className="card card-lift spotlight min-w-0 p-6 lg:col-span-3">
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

      <article data-reveal-item className="card card-lift spotlight min-w-0 p-6 lg:col-span-2">
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

      <article data-reveal-item className="card card-lift spotlight min-w-0 p-6 lg:col-span-2">
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

      <article data-reveal-item className="card card-lift spotlight min-w-0 p-6 lg:col-span-2">
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

const QUESTIONS = [
  "¿Quién aprobó este pago?",
  "¿Por qué se frenó esta factura?",
  "¿Qué cambia si subo el umbral?",
  "¿Y si algo sale mal?",
] as const;

/**
 * El panel oscuro de la portada, de borde a borde y con esquinas redondeadas: siempre con los
 * tokens del tema oscuro (`.theme-dark`), en los dos temas. Abre con las preguntas que hace
 * quien controla los pagos, que se turnan en una píldora (motion.tsx; sin animación se ve la
 * primera), y responde con el control y los datos.
 */
export function ControlPanel({ children }: { readonly children: ReactNode }) {
  return (
    <section
      id="control"
      aria-labelledby="control-titulo"
      className="theme-dark relative left-1/2 -ml-[50vw] w-screen scroll-mt-16 rounded-[32px] bg-shell py-24 text-ink sm:rounded-[48px] sm:py-32"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div data-reveal className="text-center">
          <Eyebrow>Control</Eyebrow>
          <div
            aria-hidden="true"
            className="mx-auto mt-8 grid h-14 w-fit min-w-[min(100%,24rem)] overflow-hidden rounded-[14px] border border-line bg-surface px-6"
          >
            {QUESTIONS.map((question, i) => (
              <span
                key={question}
                data-question
                className={`[grid-area:1/1] flex items-center justify-center text-[18px] font-semibold text-ink sm:text-[22px] ${i === 0 ? "" : "invisible"}`}
              >
                {question}
              </span>
            ))}
          </div>
          <h2
            id="control-titulo"
            data-reveal-title
            className="mx-auto mt-10 max-w-3xl text-[32px] leading-[1.1] font-bold tracking-[-0.02em] text-ink sm:text-[52px]"
          >
            Cada respuesta ya está escrita.
          </h2>
          <p
            data-reveal-lead
            className="mx-auto mt-5 max-w-2xl text-[16px] leading-relaxed text-ink-2 sm:text-[17px]"
          >
            El agente trabaja dentro de un mandato que tú firmas. Cada decisión se explica, se
            audita y, si hace falta, la revisa una persona antes de que el dinero se mueva.
          </p>
        </div>
        <div className="mt-16 space-y-16">{children}</div>
      </div>
    </section>
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
      className="relative py-24 text-center sm:py-32"
    >
      {/* Resplandor de marca al pie, de borde a borde: el cierre se ilumina desde abajo. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 left-1/2 -z-10 -ml-[50vw] h-[70%] w-screen overflow-hidden"
      >
        <div className="aurora aurora-cta" />
      </div>
      <h2
        id="cierre-titulo"
        data-reveal-title
        className="mx-auto max-w-3xl text-[34px] leading-[1.08] font-bold tracking-[-0.02em] text-ink sm:text-[56px]"
      >
        Paga tus facturas <span className="hero-figure">sin salirte de tus reglas.</span>
      </h2>
      <p data-reveal-lead className="mx-auto mt-5 max-w-xl text-[17px] leading-relaxed text-ink-2">
        Mira al agente decidir las {sampleCount} facturas de ejemplo. Abre una escalada y apruébala
        tú; cambia una regla y mira qué cambiaría.
      </p>
      <div data-reveal-item className="mt-9 flex justify-center">
        <DemoButton size="lg" />
      </div>
      <p className="mt-4 text-[13px] text-ink-3">
        Sin registro · datos de ejemplo · ningún pago real
      </p>
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
