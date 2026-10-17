import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as repos from "@/src/db/repositories";
import type { Notification } from "@/src/domain";
import {
  MAX_NOTIFICATION_ATTEMPTS,
  checkHealth,
  deliverDueNotifications,
  processInvoice,
  retryDelayMs,
  type DeliveryDeps,
  type NotificationSender,
} from "@/src/usecases";

import { datasetCase, openPipeline, type Pipeline } from "./helpers";

/**
 * P-87: la tabla de avisos es una cola. Cada decisión deja un aviso en pantalla (y otro por
 * Telegram si la factura llegó por ahí); uno que falla se reintenta con espera creciente,
 * nunca se entrega dos veces, y tras el último intento queda fallido y visible en la salud.
 */

let p: Pipeline;
let clock: Date;

const ok: NotificationSender = () => Promise.resolve({ simulated: false });
const broken: NotificationSender = () => Promise.reject(new Error("canal caído"));

function deps(senders: DeliveryDeps["senders"]): DeliveryDeps {
  return { db: p.t.db, newId: p.t.newId, now: () => clock, senders };
}

async function process(id: string, channel: "batch" | "telegram") {
  const f = await datasetCase(id);
  p.client.next = f.modelOutput;
  return processInvoice(p.deps, { ...p.input(f.bytes, `batch:${id}`, f.fileName), channel });
}

async function notificationsOf(invoiceId: string): Promise<Notification[]> {
  const all = await repos.listNotifications(p.t.db, p.organizationId, { limit: 500 });
  return all.filter((n) => n.payload["invoice_id"] === invoiceId);
}

beforeEach(async () => {
  p = await openPipeline();
  clock = new Date("2026-10-17T15:00:00.000Z");
}, 60_000);

afterEach(async () => {
  await p.close();
});

describe("cola de avisos (P-87)", () => {
  it("cada decisión deja un aviso en pantalla; entregarlo lo marca enviado una sola vez", async () => {
    const result = await process("nube_oct", "batch");
    const [notification] = await notificationsOf(result.invoice.id);
    expect(notification).toMatchObject({ channel: "pantalla", status: "pendiente" });

    const first = await deliverDueNotifications(deps({ pantalla: ok, telegram: ok }), {
      organizationId: p.organizationId,
    });
    expect(first.sent).toBeGreaterThanOrEqual(1);
    expect((await notificationsOf(result.invoice.id))[0]?.status).toBe("enviada");
    const second = await deliverDueNotifications(deps({ pantalla: ok, telegram: ok }), {
      organizationId: p.organizationId,
    });
    expect(second.sent).toBe(0);
    const events = await repos.listEvents(p.t.db, p.organizationId, {
      invoiceId: result.invoice.id,
      type: "notification.sent",
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toMatchObject({ channel: "pantalla", attempts: 1 });
  }, 60_000);

  it("un canal caído se reintenta con espera creciente y al último intento queda fallido", async () => {
    const result = await process("mateo_chat", "telegram");
    const channels = (await notificationsOf(result.invoice.id)).map((n) => n.channel).sort();
    expect(channels).toEqual(["pantalla", "telegram"]);
    const senders = { pantalla: ok, telegram: broken };
    const telegram = async () =>
      (await notificationsOf(result.invoice.id)).find((n) => n.channel === "telegram");

    for (let attempt = 1; attempt <= MAX_NOTIFICATION_ATTEMPTS; attempt++) {
      await deliverDueNotifications(deps(senders), { organizationId: p.organizationId });
      const n = await telegram();
      expect(n?.attempts).toBe(attempt);
      if (attempt < MAX_NOTIFICATION_ATTEMPTS) {
        expect(n?.status).toBe("pendiente");
        expect(n?.last_error).toBe("canal caído");
        const wait = retryDelayMs(attempt);
        expect(Date.parse(n?.next_attempt_at ?? "") - clock.getTime()).toBe(wait);
        // Antes de la espera no se reintenta.
        clock = new Date(clock.getTime() + wait - 1000);
        const early = await deliverDueNotifications(deps(senders), {
          organizationId: p.organizationId,
        });
        expect(early.retrying + early.failed + early.sent).toBe(0);
        clock = new Date(clock.getTime() + 1000);
      }
    }
    const final = await telegram();
    expect(final).toMatchObject({ status: "fallida", next_attempt_at: null });
    expect(retryDelayMs(1)).toBeLessThan(retryDelayMs(2));

    const failed = await repos.listEvents(p.t.db, p.organizationId, {
      invoiceId: result.invoice.id,
      type: "notification.failed",
    });
    expect(failed).toHaveLength(1);
    const health = await checkHealth({
      db: p.t.db,
      organizationId: p.organizationId,
      templateReady: () => Promise.resolve(true),
      model: { primary: "modelo" },
      now: clock,
    });
    expect(health.operation?.failedNotifications).toBe(1);
    expect(health.status).toBe("degradada");
  }, 60_000);

  it("dos entregas a la vez no mandan el mismo aviso dos veces", async () => {
    await process("nube_oct", "batch");
    await process("camila_oct", "batch");
    const sent: string[] = [];
    const slow: NotificationSender = async (n) => {
      sent.push(n.id);
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { simulated: false };
    };
    const [a, b] = await Promise.all([
      deliverDueNotifications(deps({ pantalla: slow, telegram: slow }), {
        organizationId: p.organizationId,
      }),
      deliverDueNotifications(deps({ pantalla: slow, telegram: slow }), {
        organizationId: p.organizationId,
      }),
    ]);
    expect(new Set(sent).size).toBe(sent.length);
    expect(a.sent + b.sent).toBe(sent.length);
    expect(a.skipped + b.skipped).toBeGreaterThan(0);
  }, 60_000);
});
