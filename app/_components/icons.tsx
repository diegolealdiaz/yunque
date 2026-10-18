import type { ReactNode, SVGProps } from "react";

/**
 * Iconos de línea de 16 px, un solo trazo (docs/interfaz.md §6). Decorativos: el texto de
 * al lado dice lo mismo, así que se ocultan a los lectores de pantalla.
 */

type IconProps = Omit<SVGProps<SVGSVGElement>, "children">;

function Icon({ children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 8.5l3 3 7-7" />
  </Icon>
);

export const AlertIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 2l6.5 11.5h-13z" />
    <path d="M8 6.5v3M8 11.6v.1" />
  </Icon>
);

export const StopIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M4 12l8-8" />
  </Icon>
);

export const ClockIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4.5V8l2.5 1.5" />
  </Icon>
);

export const InboxIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2 9l2-6h8l2 6v4H2z" />
    <path d="M2 9h3.5l1 1.5h3l1-1.5H14" />
  </Icon>
);

export const ListIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.1M2.5 8h.1M2.5 12h.1" />
  </Icon>
);

export const RulesIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 3h10v10H3z" />
    <path d="M5.5 6h5M5.5 8h5M5.5 10h3" />
  </Icon>
);

export const ChartIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 13.5h11M4.5 11V7M8 11V4M11.5 11V8.5" />
  </Icon>
);

export const LogIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 2.5h6l2 2v9H4z" />
    <path d="M6 7h4M6 9.5h4" />
  </Icon>
);

export const ChevronIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 4l4 4-4 4" />
  </Icon>
);

export const LockIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="7" width="9" height="6.5" rx="1" />
    <path d="M5.5 7V5a2.5 2.5 0 015 0v2" />
  </Icon>
);

export const MenuIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
  </Icon>
);

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
  </Icon>
);

export const MoonIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M13 9.5A5.5 5.5 0 116.5 3a4.5 4.5 0 006.5 6.5z" />
  </Icon>
);

export const SunIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="2.75" />
    <path d="M8 1.75v1.5M8 12.75v1.5M1.75 8h1.5M12.75 8h1.5M3.6 3.6l1.05 1.05M11.35 11.35l1.05 1.05M3.6 12.4l1.05-1.05M11.35 4.65l1.05-1.05" />
  </Icon>
);

export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="m10.5 10.5 3 3" />
  </Icon>
);

export const UploadIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 11V3M4.5 6.5 8 3l3.5 3.5M3 13h10" />
  </Icon>
);

export const PlayIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M6.75 5.75v4.5L10.25 8z" />
  </Icon>
);

/** Un documento con la esquina doblada: PDF o foto de una factura. */
export const DocumentIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 1.75h5l3 3v9.5H4z" />
    <path d="M9 1.75v3h3M6 8h4M6 10.5h4" />
  </Icon>
);

/** Un sobre: correo. */
export const MailIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="1.75" y="3.25" width="12.5" height="9.5" rx="1.5" />
    <path d="M2.25 4.25L8 8.5l5.75-4.25" />
  </Icon>
);

/** Un avión de papel: mensajería (Telegram). */
export const SendIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14.25 1.75L1.75 7l4.5 1.75L14.25 1.75z" />
    <path d="M14.25 1.75L10.5 14.25 6.25 8.75M6.25 8.75v4l2-2.25" />
  </Icon>
);

/** Llaves de código: la API. */
export const CodeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5.5 3.5L2 8l3.5 4.5M10.5 3.5L14 8l-3.5 4.5M9 2.5l-2 11" />
  </Icon>
);

/** Un destello: un agente de IA que se conecta por MCP. */
export const AgentIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 1.75c.4 2.6 1.4 3.6 4 4-2.6.4-3.6 1.4-4 4-.4-2.6-1.4-3.6-4-4 2.6-.4 3.6-1.4 4-4z" />
    <path d="M12 9.5c.2 1.3.7 1.8 2 2-1.3.2-1.8.7-2 2-.2-1.3-.7-1.8-2-2 1.3-.2 1.8-.7 2-2z" />
  </Icon>
);

/** Un enchufe: conectar canales, sistemas y agentes. */
export const PlugIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5.5 1.75v3M10.5 1.75v3M3.75 4.75h8.5v2.5a4.25 4.25 0 01-8.5 0z" />
    <path d="M8 11.5v2.75" />
  </Icon>
);
