import { instant } from "@/src/ui/format";
import { activeAccess, loadInboundAddress, loadTelegramStatus } from "@/src/usecases";

import { PageHeader } from "../../_components/page-header";
import { EmptyState } from "../../_components/states";
import { appContext } from "../../_data/context";

import { AccessPanel, type ClientAccess } from "./access-panel";

export const metadata = { title: "Conectar · Yunque" };

/**
 * Conectar (D23, D24, D32): cómo llegan las facturas reales y cómo le preguntan a Yunque tus
 * sistemas y tus agentes de IA. Correo, Telegram, la API de decisión y el MCP, cada uno con su
 * paso. Los canales reales son para los clientes: piden el código de acceso que recibieron.
 */
export default async function ConectarPage() {
  const { config, db, organization } = await appContext();
  const now = new Date();
  const accessEnabled = config.demo.enabled && config.access !== null;
  if (!accessEnabled) {
    return (
      <div className="space-y-5">
        <PageHeader title="Conectar" />
        <EmptyState
          title="Los canales reales están apagados"
          detail="Puedes subir facturas desde «Probar el agente» o desde Facturas."
          action={{ label: "Probar el agente", href: "/probar" }}
        />
      </div>
    );
  }
  const inbound = config.inboundEmail;
  const telegram = config.telegram;
  const [grant, emailAddress, telegramStatus] = await Promise.all([
    activeAccess(db, organization.id, now),
    inbound ? loadInboundAddress(db, organization.id, inbound.address, now) : null,
    telegram ? loadTelegramStatus(db, organization.id) : null,
  ]);
  const clientAccess: ClientAccess = {
    expires: grant ? instant(grant.expiresAt, config.displayTimeZone) : null,
    email: inbound
      ? { address: emailAddress?.address ?? null, maxPerDay: inbound.maxPerAddressPerDay }
      : null,
    telegram:
      telegram && telegramStatus
        ? { chats: telegramStatus.chats, maxPerDay: telegram.maxPerChatPerDay }
        : null,
    apiUrl: config.publicAppUrl,
  };
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader
        title="Conectar"
        subtitle="Tus facturas llegan por correo o Telegram, y tus sistemas y tus agentes de IA le preguntan a Yunque antes de pagar."
      />
      <AccessPanel access={clientAccess} />
    </div>
  );
}
