import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as repos from "@/src/db/repositories";
import { PolicyError, policyEditToYaml, type Finding, type Policy } from "@/src/domain";
import { decidingFinding } from "@/src/engine";
import {
  candidateFromYaml,
  changeControls,
  loadPolicyHistory,
  previewPolicyChange,
  approvePolicyProposal,
  discardPolicyProposal,
  loadPolicyProposal,
  processInvoice,
  readingFor,
  savePolicy,
  submitControls,
  submitPolicy,
  type DecideDeps,
  type ReplayResult,
} from "@/src/usecases";

import { datasetCases, openPipeline, type Pipeline } from "./helpers";

/**
 * P-106, P-107 y P-29: la política manda. Ver qué cambiaría no escribe nada y es exacto;
 * guardar crea una versión firmada y reevalúa las facturas abiertas; con la misma política,
 * el replay reproduce cada veredicto; las pagadas nunca se tocan.
 */

const SIGNER = "Diego Leal";
/** Segunda firma de los cambios que aflojan la política (cuatro ojos). */
const SECOND = "Ana Torres";
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
  await saveSigned(candidate);
  const after = await verdicts();
  const changed = [...after].filter(([id, v]) => before.get(id) !== v).map(([id]) => id);
  expect(changed.sort()).toEqual(preview.changes.map((c) => c.invoiceId).sort());
  for (const change of preview.changes) {
    expect(after.get(change.invoiceId)).toBe(`${change.after.verdict}:${change.after.rule ?? "-"}`);
  }
  return preview.changes.length;
}

/** Guarda como en la pantalla: si el cambio afloja, lo propone SIGNER y lo aprueba SECOND. */
async function saveSigned(candidate: Policy, note: string | null = null): Promise<ReplayResult> {
  const submitted = await submitPolicy(deps(), {
    organizationId: p.organizationId,
    candidate,
    baseVersion: await currentVersion(),
    signedBy: SIGNER,
    note,
  });
  if (submitted.kind === "guardada") return submitted;
  const approved = await approvePolicyProposal(deps(), {
    organizationId: p.organizationId,
    proposalId: submitted.proposal.id,
    approver: SECOND,
  });
  if (approved.kind !== "politica") throw new Error("se esperaba una versión de la política");
  return approved;
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
    // Las 21 abiertas del dataset más la frenada del historial, que no tiene lectura y se omite.
    expect(preview.evaluated).toBe(22);
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
    const result = await saveSigned(candidate, "Umbral al límite por pago");
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

describe("una reevaluación no ablanda lo que no cambió", () => {
  it("conserva la ambigüedad de dos lecturas distintas, salvo si una persona fijó el campo", async () => {
    const id = ids.get("sobre_umbral") ?? "";
    const invoice = await repos.getInvoice(p.t.db, p.organizationId, id);
    const decision = await repos.getLatestDecision(p.t.db, p.organizationId, id);
    const stored = await repos.getLatestExtraction(p.t.db, p.organizationId, id);
    if (!decision || stored?.record.extraction.kind !== "invoice") throw new Error("sin lectura");
    // La primera pasada leyó 845,00 y la segunda 8.500,00: la verificación de la lectura
    // guardada no puede volver a ver ese desacuerdo.
    const ambiguous: Finding = {
      code: "field_ambiguous",
      severity: "block",
      action: "escalar",
      observed: "845,00 BRL | 8.500,00 BRL",
      threshold: "un solo valor",
      evidence: null,
      field: "total",
      message: "El campo total tiene más de un valor posible en el documento",
    };
    const previous = { ...decision, findings: [...decision.findings, ambiguous] };
    const reading = readingFor(invoice, [previous], stored.record);
    expect(reading.verification.ambiguities).toContainEqual({
      field: "total",
      candidates: ["845,00 BRL", "8.500,00 BRL"],
    });

    const { fields } = stored.record.extraction;
    const confirmed = {
      ...stored.record,
      extraction: {
        ...stored.record.extraction,
        fields: { ...fields, total: { ...fields.total, source: "humano" as const } },
      },
    };
    const resolved = readingFor(invoice, [previous], confirmed);
    expect(resolved.verification.ambiguities.some((a) => a.field === "total")).toBe(false);
  });
});

/** La doble firma viene apagada; estas pruebas la encienden, que es inmediato. */
async function enableFourEyes(): Promise<void> {
  await changeControls(deps(), {
    organizationId: p.organizationId,
    controls: { four_eyes: true },
    signedBy: SIGNER,
  });
}

describe("cuatro ojos al aflojar la política (P-154)", () => {
  beforeEach(enableFourEyes);
  const propose = async (candidate: Policy, by = SIGNER) =>
    submitPolicy(deps(), {
      organizationId: p.organizationId,
      candidate,
      baseVersion: await currentVersion(),
      signedBy: by,
      note: "Hardware recurrente",
    });

  it("un cambio que afloja queda propuesto y no cambia nada hasta la segunda firma", async () => {
    const base = await currentVersion();
    const result = await propose(higherThreshold(await current()));
    if (result.kind !== "propuesta") throw new Error("se esperaba una propuesta");
    expect(result.proposal.loosenings[0]).toMatch(/^Sube el umbral de aprobación/);
    expect(await currentVersion()).toBe(base);
    const invoice = await repos.getInvoice(p.t.db, p.organizationId, ids.get("sobre_umbral") ?? "");
    expect(invoice.status).toBe("esperando_aprobacion");
    expect((await loadPolicyProposal(p.t.db, p.organizationId))?.id).toBe(result.proposal.id);

    // Ni quien propuso, ni una firma única por el camino directo.
    await expect(
      approvePolicyProposal(deps(), {
        organizationId: p.organizationId,
        proposalId: result.proposal.id,
        approver: SIGNER,
      }),
    ).rejects.toMatchObject({ code: "second_signature_required" });
    await expect(
      savePolicy(deps(), {
        organizationId: p.organizationId,
        candidate: higherThreshold(await current()),
        baseVersion: base,
        signedBy: SECOND,
        note: null,
      }),
    ).rejects.toMatchObject({ code: "second_signature_required" });
    // Mientras hay una abierta, no se propone otra.
    await expect(propose(higherThreshold(await current()), SECOND)).rejects.toMatchObject({
      code: "proposal_pending",
    });

    const saved = await approvePolicyProposal(deps(), {
      organizationId: p.organizationId,
      proposalId: result.proposal.id,
      approver: SECOND,
    });
    expect(saved.version.version).toBe(base + 1);
    expect(saved.version.signed_by).toBe(SIGNER);
    expect(saved.version.note).toBe("Segunda firma: Ana Torres · Hardware recurrente");
    const paid = await repos.getInvoice(p.t.db, p.organizationId, ids.get("sobre_umbral") ?? "");
    expect(paid.status).toBe("decidida");
    expect(await loadPolicyProposal(p.t.db, p.organizationId)).toBeNull();
    const events = await repos.listEvents(p.t.db, p.organizationId, { limit: 50 });
    expect(
      events.some((e) => e.type === "policy.proposal_closed" && e.data["outcome"] === "aprobada"),
    ).toBe(true);
    // Ya aprobada, no se puede aprobar otra vez.
    await expect(
      approvePolicyProposal(deps(), {
        organizationId: p.organizationId,
        proposalId: result.proposal.id,
        approver: SECOND,
      }),
    ).rejects.toMatchObject({ code: "proposal_closed" });
  }, 120_000);

  it("endurecer se guarda directo, con una sola firma", async () => {
    const policy = await current();
    const stricter = candidateFromYaml(
      policy,
      policyEditToYaml(policy).replace(/(max_days_overdue:) \d+/, "$1 10"),
    );
    expect(stricter.rules.due_date_window.max_days_overdue).toBe(10);
    const base = await currentVersion();
    const result = await propose(stricter);
    expect(result.kind).toBe("guardada");
    expect(await currentVersion()).toBe(base + 1);
  }, 120_000);

  it("una propuesta se descarta, y una que quedó vieja ya no se aprueba", async () => {
    const first = await propose(higherThreshold(await current()));
    if (first.kind !== "propuesta") throw new Error("se esperaba una propuesta");
    await discardPolicyProposal(deps(), {
      organizationId: p.organizationId,
      proposalId: first.proposal.id,
      by: SIGNER,
    });
    expect(await loadPolicyProposal(p.t.db, p.organizationId)).toBeNull();

    const second = await propose(higherThreshold(await current()));
    if (second.kind !== "propuesta") throw new Error("se esperaba una propuesta");
    // Otra versión entra mientras tanto (apagar pagos): la propuesta vence.
    await changeControls(deps(), {
      organizationId: p.organizationId,
      controls: { payments_enabled: false },
      signedBy: SIGNER,
    });
    expect((await loadPolicyProposal(p.t.db, p.organizationId))?.stale).toBe(true);
    await expect(
      approvePolicyProposal(deps(), {
        organizationId: p.organizationId,
        proposalId: second.proposal.id,
        approver: SECOND,
      }),
    ).rejects.toMatchObject({ code: "proposal_closed" });
    // Y una nueva propuesta la reemplaza.
    const third = await propose(higherThreshold(await current()));
    expect(third.kind).toBe("propuesta");
  }, 120_000);
});

describe("cuatro ojos al encender un interruptor (P-154)", () => {
  beforeEach(enableFourEyes);
  it("apagar es inmediato; encender queda propuesto y lo aprueba otra persona", async () => {
    const off = await submitControls(deps(), {
      organizationId: p.organizationId,
      controls: { payments_enabled: false },
      signedBy: SIGNER,
    });
    expect(off.kind).toBe("guardada");
    expect((await current()).controls.payments_enabled).toBe(false);

    const on = await submitControls(deps(), {
      organizationId: p.organizationId,
      controls: { payments_enabled: true },
      signedBy: SIGNER,
    });
    if (on.kind !== "propuesta") throw new Error("se esperaba una propuesta");
    expect((await current()).controls.payments_enabled).toBe(false);
    await expect(
      changeControls(deps(), {
        organizationId: p.organizationId,
        controls: { payments_enabled: true },
        signedBy: SECOND,
      }),
    ).rejects.toMatchObject({ code: "second_signature_required" });
    await expect(
      approvePolicyProposal(deps(), {
        organizationId: p.organizationId,
        proposalId: on.proposal.id,
        approver: SIGNER,
      }),
    ).rejects.toMatchObject({ code: "second_signature_required" });

    const approved = await approvePolicyProposal(deps(), {
      organizationId: p.organizationId,
      proposalId: on.proposal.id,
      approver: SECOND,
    });
    expect(approved.kind).toBe("controles");
    expect((await current()).controls.payments_enabled).toBe(true);
    expect(await loadPolicyProposal(p.t.db, p.organizationId)).toBeNull();
  }, 120_000);
});
