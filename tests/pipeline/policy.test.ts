import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as repos from "@/src/db/repositories";
import { PolicyError, policyEditToYaml, type Policy } from "@/src/domain";
import { decidingFinding } from "@/src/engine";
import {
  candidateFromYaml,
  changeControls,
  loadPolicyHistory,
  previewPolicyChange,
  processInvoice,
  savePolicy,
  type DecideDeps,
} from "@/src/usecases";

import { datasetCases, openPipeline, type Pipeline } from "./helpers";

/**
 * P-106, P-107 y P-29: la política manda. Ver qué cambiaría no escribe nada y es exacto;
 * guardar crea una versión firmada y reevalúa las facturas abiertas; con la misma política,
 * el replay reproduce cada veredicto; las pagadas nunca se tocan.
 */

const SIGNER = "Diego Leal";
let p: Pipeline;
const ids = new Map<string, string>();

function deps(): DecideDeps {
  return {
    db: p.t.db,
    newId: p.t.newId,
    now: p.t.now,
    timeZone: "America/Bogota",
    businessDate: "2026-10-17",
  };
}

beforeEach(async () => {
  p = await openPipeline();
  ids.clear();
  for (const f of await datasetCases()) {
    p.client.next = f.modelOutput;
    const result = await processInvoice(p.deps, {
      ...p.input(f.bytes, `batch:${f.case.id}`, f.fileName),
      channel: "batch",
    });
    ids.set(f.case.id, result.invoice.id);
  }
}, 180_000);

afterEach(async () => {
  await p.close();
});

/** La política vigente con el umbral de aprobación subido al límite por pago. */
function higherThreshold(current: Policy): Policy {
  const yaml = policyEditToYaml(current).replace(
    /approval_threshold:\n(\s+)amount: \d+/,
    `approval_threshold:\n$1amount: ${String(current.limits.per_payment.amount)}`,
  );
  return candidateFromYaml(current, yaml);
}

/** Veredicto y regla vigentes de cada factura de la empresa. */
async function verdicts(): Promise<Map<string, string>> {
  const invoices = await repos.listInvoices(p.t.db, p.organizationId, { limit: 500 });
  const latest = await repos.listLatestDecisions(
    p.t.db,
    p.organizationId,
    invoices.map((i) => i.id),
  );
  return new Map(
    [...latest].map(([id, d]) => [id, `${d.verdict}:${decidingFinding(d)?.code ?? "-"}`]),
  );
}

/**
 * Guarda el candidato y comprueba que el replay cambió exactamente las facturas que la vista
 * previa anunció, cada una al veredicto y la regla anunciados.
 */
async function expectReplayAsPreviewed(candidate: Policy): Promise<number> {
  const preview = await previewPolicyChange(deps(), {
    organizationId: p.organizationId,
    candidate,
  });
  const before = await verdicts();
  await savePolicy(deps(), {
    organizationId: p.organizationId,
    candidate,
    baseVersion: await currentVersion(),
    signedBy: SIGNER,
    note: null,
  });
  const after = await verdicts();
  const changed = [...after].filter(([id, v]) => before.get(id) !== v).map(([id]) => id);
  expect(changed.sort()).toEqual(preview.changes.map((c) => c.invoiceId).sort());
  for (const change of preview.changes) {
    expect(after.get(change.invoiceId)).toBe(`${change.after.verdict}:${change.after.rule ?? "-"}`);
  }
  return preview.changes.length;
}

/** Número de la versión vigente: sobre ella se edita lo que se guarda. */
async function currentVersion(): Promise<number> {
  return (await repos.getCurrentPolicy(p.t.db, p.organizationId))?.version ?? 0;
}

async function current(): Promise<Policy> {
  const version = await repos.getCurrentPolicy(p.t.db, p.organizationId);
  if (!version) throw new Error("sin política");
  return version.content;
}

describe("ver qué cambiaría (P-107)", () => {
  it("subir el umbral muestra exactamente la escalada que pasaría a pagar, sin escribir nada", async () => {
    const decisionsBefore = await repos.listDecisionsSince(
      p.t.db,
      p.organizationId,
      "2026-01-01T00:00:00.000Z",
    );
    const preview = await previewPolicyChange(deps(), {
      organizationId: p.organizationId,
      candidate: higherThreshold(await current()),
    });
    const change = preview.changes.find((c) => c.invoiceId === ids.get("sobre_umbral"));
    expect(change?.before).toEqual({ verdict: "escalar", rule: "amount_over_approval_threshold" });
    expect(change?.after.verdict).toBe("pagar");
    // Las 18 abiertas del dataset más la frenada del historial, que no tiene lectura y se omite.
    expect(preview.evaluated).toBe(19);
    expect(preview.skipped).toBe(1);
    // Nada escrito: ni decisiones nuevas ni versión nueva.
    const decisionsAfter = await repos.listDecisionsSince(
      p.t.db,
      p.organizationId,
      "2026-01-01T00:00:00.000Z",
    );
    expect(decisionsAfter).toHaveLength(decisionsBefore.length);
    expect((await repos.getCurrentPolicy(p.t.db, p.organizationId))?.version).toBe(1);
  }, 120_000);

  it("guardar cambia exactamente lo que la vista previa dijo, y la bitácora lo registra", async () => {
    const candidate = higherThreshold(await current());
    const preview = await previewPolicyChange(deps(), {
      organizationId: p.organizationId,
      candidate,
    });
    const result = await savePolicy(deps(), {
      organizationId: p.organizationId,
      candidate,
      baseVersion: await currentVersion(),
      signedBy: SIGNER,
      note: "Umbral al límite por pago",
    });
    expect(result.version.version).toBe(2);
    expect(result.version.signed_by).toBe(SIGNER);
    expect(result.changed).toBe(preview.changes.length);
    expect(result.evaluated).toBe(preview.evaluated);
    const invoice = await repos.getInvoice(p.t.db, p.organizationId, ids.get("sobre_umbral") ?? "");
    expect(invoice.status).toBe("decidida");
    const events = await repos.listEvents(p.t.db, p.organizationId, { limit: 500 });
    expect(events.some((e) => e.type === "policy.saved" && e.data["version"] === 2)).toBe(true);
    expect(
      events.some((e) => e.type === "policy.replayed" && e.data["changed"] === result.changed),
    ).toBe(true);
    const history = await loadPolicyHistory(p.t.db, p.organizationId);
    expect(history.current?.version).toBe(2);
    expect(history.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(history.lastReplay).toMatchObject({
      who: SIGNER,
      version: 2,
      changed: result.changed,
      reevaluated: result.evaluated - result.skipped,
    });
  }, 120_000);
});

describe("la vista previa es exacta (P-107)", () => {
  it("con el presupuesto justo, lo que paga una factura ya no cabe para la siguiente", async () => {
    const raised = higherThreshold(await current());
    const ledger = await repos.getLedgerPeriod(p.t.db, p.organizationId, "2026-10", "USD");
    if (!ledger) throw new Error("sin periodo");
    // Queda espacio para un pago chico, no para el que libera el umbral nuevo.
    const tight = candidateFromYaml(
      raised,
      policyEditToYaml(raised).replace(
        /budget:\n(\s+)amount: \d+/,
        `budget:\n$1amount: ${String(ledger.committed + 100_000)}`,
      ),
    );
    await expectReplayAsPreviewed(tight);
  }, 120_000);

  it("en modo de prueba el replay no reserva, y la vista previa tampoco", async () => {
    await changeControls(deps(), {
      organizationId: p.organizationId,
      controls: { dry_run: true },
      signedBy: SIGNER,
    });
    expect(await expectReplayAsPreviewed(higherThreshold(await current()))).toBeGreaterThan(0);
  }, 120_000);
});

describe("guardar y reproducir (P-106, P-29)", () => {
  it("P-29 con la misma política el replay reproduce cada veredicto, y las pagadas no se tocan", async () => {
    const paidBefore = (
      await repos.listDecisionsSince(p.t.db, p.organizationId, "2026-10-01T00:00:00.000Z")
    ).filter((d) => d.verdict === "pagar").length;
    const result = await savePolicy(deps(), {
      organizationId: p.organizationId,
      candidate: await current(),
      baseVersion: await currentVersion(),
      signedBy: SIGNER,
      note: null,
    });
    expect(result.changed).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);
    const paidAfter = (
      await repos.listDecisionsSince(p.t.db, p.organizationId, "2026-10-01T00:00:00.000Z")
    ).filter((d) => d.verdict === "pagar").length;
    expect(paidAfter).toBe(paidBefore);
  }, 120_000);

  it("las claves protegidas y los controles no se cambian desde el YAML; solo firma un aprobador", async () => {
    const policy = await current();
    const withProtected = `${policyEditToYaml(policy)}protected:\n  approvers: [Intruso]\n`;
    expect(() => candidateFromYaml(policy, withProtected)).toThrow(PolicyError);
    const withControls = `${policyEditToYaml(policy)}controls:\n  payments_enabled: false\n`;
    expect(() => candidateFromYaml(policy, withControls)).toThrow(PolicyError);
    await expect(
      savePolicy(deps(), {
        organizationId: p.organizationId,
        candidate: policy,
        baseVersion: await currentVersion(),
        signedBy: "Alguien Más",
        note: null,
      }),
    ).rejects.toMatchObject({ code: "not_authorized" });
  });

  it("no pisa lo que otra persona guardó: se rechaza si la versión editada ya no es la vigente", async () => {
    const edited = await currentVersion();
    const candidate = higherThreshold(await current());
    // Otra pestaña apaga los pagos mientras tanto: eso crea una versión nueva.
    await changeControls(deps(), {
      organizationId: p.organizationId,
      controls: { payments_enabled: false },
      signedBy: SIGNER,
    });
    await expect(
      savePolicy(deps(), {
        organizationId: p.organizationId,
        candidate,
        baseVersion: edited,
        signedBy: SIGNER,
        note: null,
      }),
    ).rejects.toMatchObject({ code: "policy_changed" });
    const now = await current();
    expect(now.controls.payments_enabled).toBe(false);
    expect(await currentVersion()).toBe(edited + 1);
  });

  it("un interruptor crea una versión con su evento, sin tocar el resto de la política", async () => {
    const before = await current();
    const version = await changeControls(deps(), {
      organizationId: p.organizationId,
      controls: { payments_enabled: false },
      signedBy: SIGNER,
    });
    expect(version.content.controls.payments_enabled).toBe(false);
    expect(version.content.limits).toEqual(before.limits);
    expect(version.content.protected).toEqual(before.protected);
    const events = await repos.listEvents(p.t.db, p.organizationId, { limit: 5 });
    expect(events[0]?.type).toBe("controls.changed");
    expect(events[0]?.actor).toEqual({ kind: "humano", name: SIGNER });
  });
});
