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
  { href: "#producto", label: "Producto" },
  { href: "#control", label: "Seguridad" },
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
          {/*
            Cada línea sube desde abajo de su máscara. El relleno de abajo deja entero el descenso
            de la «g» en todos los tamaños; el margen negativo devuelve el espacio entre líneas.
          */}
          <span className="-mb-[0.12em] block overflow-hidden pb-[0.2em]">
            <span data-intro="line" className="block">
              Paga tus facturas
            </span>
          </span>
          <span className="-mb-[0.12em] block overflow-hidden pb-[0.08em]">
            {/* El degradado cubre la caja de la línea: el relleno lo extiende hasta la «g». */}
            <span data-intro="line" className="hero-figure block pb-[0.12em]">
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

/**
 * El producto de verdad, dentro del portal: la bandeja de Pendientes con el lote de ejemplo ya
 * decidido. Se entiende de un vistazo aun pequeña: el agente ya resolvió y a la persona solo
 * le llega lo que necesita criterio, cada factura con su veredicto y su motivo.
 */
export function ProductShot() {
  return (
    <figure className="relative mx-auto overflow-hidden rounded-[18px] border border-line bg-surface shadow-2xl shadow-black/15">
      <div
        aria-hidden="true"
        className="flex items-center gap-1.5 border-b border-line bg-surface-sunken px-4 py-2.5"
      >
        <span className="size-2.5 rounded-full bg-line-strong" />
        <span className="size-2.5 rounded-full bg-line-strong" />
        <span className="size-2.5 rounded-full bg-line-strong" />
        <span className="ml-3 font-mono text-[11px] text-ink-3">yunque · pendientes</span>
      </div>
      {/* En el teléfono, solo la bandeja: la pantalla entera no se leería. */}
      <Image
        src="/producto/pendientes-movil.webp"
        alt="Pendientes: nueve facturas esperan una decisión, cada una con su veredicto y su motivo"
        width={1200}
        height={692}
        priority
        sizes="100vw"
        className="block h-auto w-full sm:hidden"
      />
      <Image
        src="/producto/pendientes.webp"
        alt="Pendientes: el agente pagó 14 facturas, frenó 10 y nueve esperan una decisión, cada una con su veredicto y su motivo"
        width={1600}
        height={1000}
        priority
        sizes="(min-width: 1024px) 1024px, 100vw"
        className="hidden h-auto w-full sm:block"
      />
    </figure>
  );
}

/**
 * Las cifras que venden, medidas: cero pagos indebidos (la integración continua falla si
 * aparece uno), los controles de cada factura y lo que cuesta y tarda cada decisión.
 */
export function Numbers({ ruleCount }: { readonly ruleCount: number }) {
  // `count`: la cifra cuenta hasta su valor al aparecer; el texto final es el del servidor.
  const stats = [
    {
      value: "0",
      unit: "",
      count: false,
      label: "pagos indebidos",
      detail: "en el set de prueba; si aparece uno, el cambio no entra",
      hero: true,
    },
    {
      value: String(ruleCount),
      unit: "",
      count: true,
      label: "controles",
      detail: "revisan cada factura antes de decidir",
      hero: false,
    },
    {
      value: "5",
      unit: " s",
      count: true,
      label: "por factura",
      detail: "en promedio, de la llegada a la decisión",
      hero: false,
    },
    {
      value: "0,002",
      unit: "",
      count: false,
      label: "USD por factura",
      detail: "lo que cuesta la lectura con IA, medido",
      hero: false,
    },
  ];
  return (
    <section aria-label="Cifras medidas" data-reveal className="py-4">
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[18px] border border-line bg-line lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} data-reveal-item className="bg-surface px-4 py-6 sm:px-6 sm:py-7">
            <dt className="sr-only">{stat.label}</dt>
            <dd>
              <p
                className={`num font-mono text-[34px] leading-none font-bold tracking-tight sm:text-[44px] ${stat.hero ? "hero-figure" : "text-ink"}`}
              >
                <span data-count-to={stat.count ? stat.value : undefined}>{stat.value}</span>
                {stat.unit}
              </p>
              <p className="mt-3 text-[15px] font-semibold text-ink">{stat.label}</p>
              <p className="mt-1 text-[13px] leading-snug text-ink-3">{stat.detail}</p>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const STEPS = [
  {
    n: "01",
    title: "Recibe",
    body: "Por PDF, foto, correo o Telegram, sin portales nuevos para tus proveedores. Una misma factura nunca se procesa dos veces.",
  },
  {
    n: "02",
    title: "Lee y revisa",
    body: "La IA solo lee: cada dato con su cita en el documento. Después, controles fijos revisan proveedor, cuenta, monto, presupuesto, duplicados e instrucciones ocultas.",
  },
  {
    n: "03",
    title: "Decide y explica",
    body: "Paga lo que cumple, frena lo sospechoso y te pasa lo que necesita criterio, con el porqué en palabras simples.",
  },
] as const;

/**
 * Cómo funciona, en tres pasos; el último muestra los tres veredictos. En escritorio, encima,
 * una línea une los tres pasos y se dibuja al bajar, encendiendo cada punto (motion.tsx).
 */
export function Steps() {
  return (
    <div>
      <div aria-hidden="true" className="relative mb-6 hidden grid-cols-3 lg:grid">
        <span className="absolute top-1/2 right-[calc(100%/6)] left-[calc(100%/6)] h-px bg-line-strong" />
        <span
          data-steps-line
          className="absolute top-1/2 right-[calc(100%/6)] left-[calc(100%/6)] h-0.5 -translate-y-1/2 origin-left rounded-full bg-linear-to-r from-brand to-[var(--brand-grad-end)]"
        />
        {STEPS.map((step) => (
          <span key={step.n} className="relative flex justify-center">
            <span
              data-step-dot
              className="inline-flex size-10 items-center justify-center rounded-full border border-brand/30 bg-surface font-mono text-[13px] font-semibold text-brand shadow-sm"
            >
              {step.n}
            </span>
          </span>
        ))}
      </div>
      <ol className="grid gap-4 lg:grid-cols-3">
        {STEPS.map((step, i) => (
          <li key={step.n} data-reveal-item className="card card-lift spotlight p-7">
            <p className="font-mono text-[13px] text-brand lg:hidden">{step.n}</p>
            <h3 className="mt-3 text-[22px] font-bold tracking-tight text-ink lg:mt-0">
              {step.title}
            </h3>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{step.body}</p>
            {i === STEPS.length - 1 ? (
              <p className="mt-5 flex flex-wrap gap-2 text-[12px] font-semibold">
                <span className="rounded-full bg-pay-tint px-2.5 py-1 text-pay">Pagar</span>
                <span className="rounded-full bg-escalate-tint px-2.5 py-1 text-escalate">
                  Escalar
                </span>
                <span className="rounded-full bg-hold-tint px-2.5 py-1 text-hold">Frenar</span>
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

const CHANNELS = [
  {
    name: "PDF o foto",
    title: "Súbela desde la pantalla.",
    body: "Arrastra el PDF o la foto, o procesa de una vez el lote del periodo. Lee también escaneos sin texto.",
    sample: [
      ["Archivo", "AH-5560.pdf"],
      ["Lectura", "cada campo con su cita"],
      ["Lote", "33 facturas del periodo"],
    ],
  },
  {
    name: "Correo",
    title: "Reenvía la factura y listo.",
    body: "Cada empresa tiene su dirección: el agente lee el adjunto o el cuerpo del correo.",
    sample: [
      ["De", "facturacion@nubeandina.example"],
      ["Asunto", "Factura F-2291 · octubre"],
      ["Adjunto", "F-2291.pdf"],
    ],
  },
  {
    name: "Telegram",
    title: "Una foto desde el teléfono.",
    body: "Manda la factura al bot y recibe en el mismo chat el aviso de cada decisión, con su motivo.",
    sample: [
      ["Tú", "foto · factura-andes.jpg"],
      ["Yunque", "Escalada: supera el umbral"],
      ["Yunque", "Revísala en Pendientes"],
    ],
  },
] as const;

/** Dónde vive el agente: tres tarjetas lado a lado, cada una con un ejemplo de su canal. */
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
              <div
                key={`${label}-${value}`}
                data-row
                className="flex items-center gap-4 px-4 py-2.5"
              >
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

const GUARANTEES = [
  {
    title: "Nunca paga fuera de tus reglas",
    body: "La IA solo lee; las reglas deciden. Lo que diga una factura puede endurecer una decisión, nunca ablandarla. Por encima del umbral, siempre decide una persona.",
  },
  {
    title: "Doble firma",
    body: "Aflojar una regla, volver a encender los pagos o registrar un proveedor nuevo lo confirma otra persona. Cada empresa decide si la usa.",
  },
  {
    title: "Proveedores verificados",
    body: "Una cuenta distinta de la registrada se frena. Un proveedor nuevo se registra desde su factura, y una cuenta conocida con otro nombre se bloquea.",
  },
  {
    title: "Todo queda escrito",
    body: "Cada decisión con su regla, su valor y su umbral, y quién aprobó. Antes de guardar un cambio ves qué facturas cambiarían. Nada se edita ni se borra.",
  },
] as const;

const NEVER = [
  "Pagar por encima del tope absoluto del sistema, ni aunque la política lo permita.",
  "Seguir instrucciones escritas dentro de una factura o de su correo.",
  "Ejecutar el pago: deja la orden preparada para tu plataforma de pagos.",
] as const;

/** Seguridad: cuatro garantías y lo que Yunque nunca hace, dentro del panel oscuro. */
export function Guarantees() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {GUARANTEES.map((item) => (
          <article key={item.title} data-reveal-item className="card card-lift spotlight p-6">
            <span
              data-pop-in
              className="inline-flex size-8 items-center justify-center rounded-full bg-brand-tint text-brand"
            >
              <CheckIcon className="size-4" />
            </span>
            <h3 className="mt-4 text-[17px] font-bold tracking-tight text-ink">{item.title}</h3>
            <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{item.body}</p>
          </article>
        ))}
      </div>
      <article data-reveal-item className="card p-6">
        <h3 className="flex items-center gap-2 text-[15px] font-bold text-ink">
          <LockIcon /> Lo que Yunque nunca hace
        </h3>
        <ul className="mt-3 grid gap-3 text-[13px] leading-relaxed md:grid-cols-3">
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
    a: "Solo las personas aprobadoras de la política. Cada cambio es una versión firmada y, antes de guardarla, se ve qué facturas cambiarían. Con la doble firma, un cambio que afloja una regla lo confirma otra persona.",
  },
  {
    q: "¿Y si la factura es de un proveedor nuevo?",
    a: "No se paga sola: llega a Pendientes con el motivo. Ahí mismo una persona registra al proveedor con los datos de la factura, y con la doble firma otra lo verifica. Desde entonces, sus facturas se pagan solas dentro de las reglas.",
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
