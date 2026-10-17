import { describe, expect, it } from "vitest";

import { loadDatasetSources } from "@/src/dataset";
import { isPresent, type Extraction } from "@/src/domain";
import {
  amountFromLiteral,
  datesFromLiteral,
  needsFallback,
  spanishWordsToNumber,
  totalsInText,
  verifyExtraction,
  wordsAmount,
} from "@/src/extraction";

import { generatedFile, idealExtraction } from "./helpers";
import { pdfText } from "@/src/dataset";

async function caseExtraction(id: string): Promise<{ extraction: Extraction; text: string }> {
  const src = await loadDatasetSources();
  const c = src.manifest.cases.find((x) => x.id === id);
  const t = c && src.templates.get(c.template);
  if (!c || !t) throw new Error(`caso ${id} ausente`);
  const text = await pdfText(await generatedFile(`${c.same_document_as ?? c.id}.pdf`));
  return { extraction: idealExtraction(c, t), text };
}

type InvoiceExtraction = Extract<Extraction, { kind: "invoice" }>;
type Fields = InvoiceExtraction["fields"];

function withField(extraction: Extraction, patch: (e: InvoiceExtraction) => void): Extraction {
  const copy = structuredClone(extraction);
  if (copy.kind === "invoice") patch(copy);
  return copy;
}

/** Campo presente de una extracción de factura; lanza si el campo está ausente. */
function presentField<N extends keyof Fields>(e: InvoiceExtraction, name: N) {
  const field: Fields[N] = e.fields[name];
  if (!isPresent(field)) throw new Error(`${name} ausente`);
  return field;
}

/** Extracción mínima cuyos identificadores vienen sin espacios y las citas con el formato impreso. */
function baseFieldsFor(text: string): Extraction {
  const field = <T>(value: T, literal: string) => ({
    value,
    evidence: { literal, quote: literal, page: 1 },
    confidence: 0.96,
    source: "modelo" as const,
  });
  const missing = { value: null, reason: "no aparece" };
  return {
    kind: "invoice",
    language: "de",
    fields: {
      payee_name: field("Datenwerk GmbH", "Datenwerk GmbH"),
      payee_tax_id: field("DE123456789", text.split("\n")[1] ?? ""),
      invoice_number: field("RE-2026-118", "RE 2026 118"),
      issue_date: missing,
      due_date: missing,
      currency: field("EUR", "EUR"),
      subtotal: missing,
      taxes: missing,
      total: field(100, "1,00"),
      bank_account: field("DE89370400440532013000", "DE89 3704 0044 0532 0130 00"),
      bank_holder: missing,
      hours: missing,
      purchase_order: missing,
      description: missing,
    },
    ambiguities: [],
    suspicions: [],
  };
}

describe("Verificador (P-66 a P-68)", () => {
  it("una extracción fiel del dataset pasa sin hallazgos", async () => {
    for (const id of [
      "nube_oct",
      "mateo_oct",
      "lucia_oct",
      "stackline_oct",
      "saldo_insuficiente",
    ]) {
      const { extraction, text } = await caseExtraction(id);
      const v = verifyExtraction(extraction, text);
      expect(v.issues, id).toEqual([]);
      expect(v.report.ambiguities, id).toEqual([]);
      expect(v.report.totals, id).toBe(id === "lucia_oct" ? "not_applicable" : "ok");
      expect(needsFallback(v)).toBe(false);
    }
  });

  it("P-66 una cita inventada produce evidence_missing; espacios y saltos distintos pasan", async () => {
    const { extraction, text } = await caseExtraction("nube_oct");
    const invented = withField(extraction, (e) => {
      presentField(e, "total").evidence.literal = "TOTAL: 9.999.999,00";
    });
    const v = verifyExtraction(invented, text);
    expect(v.issues).toEqual([{ kind: "evidence_missing", field: "total" }]);
    expect(v.report.evidence_missing).toEqual(["total"]);
    const spaced = withField(extraction, (e) => {
      presentField(e, "description").evidence.literal = "Hosting   y soporte,\noctubre 2026";
    });
    expect(verifyExtraction(spaced, text).issues).toEqual([]);
  });

  it("P-67 valor que no se deriva de la cita produce hallazgo; monto en letras distinto produce field_ambiguous", async () => {
    const { extraction, text } = await caseExtraction("nube_oct");
    const wrong = withField(extraction, (e) => {
      presentField(e, "total").value = 480000001;
    });
    const v = verifyExtraction(wrong, text);
    expect(v.issues[0]).toMatchObject({ kind: "value_not_derived", field: "total" });
    // Para el Juez, cita ausente y valor no derivado son lo mismo: sin evidencia válida.
    expect(v.report.evidence_missing).toEqual(["total"]);
    const wrongDate = withField(extraction, (e) => {
      presentField(e, "due_date").value = "2026-10-26";
    });
    expect(verifyExtraction(wrongDate, text).issues[0]).toMatchObject({ field: "due_date" });

    const words = await caseExtraction("adv_monto_en_letras");
    const vw = verifyExtraction(words.extraction, words.text);
    expect(vw.report.ambiguities).toEqual([
      { field: "total", candidates: ["7800000", "178000 en letras"] },
    ]);
    // La ambigüedad viene del documento: otra lectura no la resuelve, no se paga respaldo.
    expect(needsFallback(vw)).toBe(false);
  });

  it("dos totales en el documento producen field_ambiguous", async () => {
    const { extraction, text } = await caseExtraction("adv_dos_totales");
    const v = verifyExtraction(extraction, text);
    expect(v.report.ambiguities[0]).toMatchObject({
      field: "total",
      candidates: ["480000000", "530000000"],
    });
  });

  it("P-68 subtotal más impuestos distinto del total fuera de tolerancia produce totals_mismatch", async () => {
    const { extraction, text } = await caseExtraction("nube_oct");
    const off = withField(extraction, (e) => {
      presentField(e, "taxes").value = 76638754;
      presentField(e, "taxes").evidence.literal = "766.387,54";
    });
    const v = verifyExtraction(off, text);
    // La cita ya no está en el documento (evidence_missing) y además los totales no cuadran.
    expect(v.report.totals).toBe("mismatch");
    const within = withField(extraction, (e) => {
      presentField(e, "total").value = 480000001;
      presentField(e, "total").evidence.literal = "4.800.000,01";
    });
    expect(verifyExtraction(within, text).report.totals).toBe("ok");
    const two = withField(extraction, (e) => {
      presentField(e, "total").value = 480000002;
      presentField(e, "total").evidence.literal = "4.800.000,02";
    });
    expect(verifyExtraction(two, text).report.totals).toBe("mismatch");
  });

  it("cuentas, identificadores y números con el formato impreso (espacios, puntos) se derivan", () => {
    const text = [
      "Datenwerk GmbH",
      "USt-IdNr. DE 123 456 789",
      "Rechnung RE 2026 118",
      "Gesamtbetrag: 1,00 EUR",
      "IBAN: DE89 3704 0044 0532 0130 00",
    ].join("\n");
    const base = baseFieldsFor(text);
    const v = verifyExtraction(base, text);
    expect(v.issues).toEqual([]);
  });

  it("sin texto (escaneado) solo verifica la coherencia interna", async () => {
    const { extraction } = await caseExtraction("nube_oct");
    const v = verifyExtraction(extraction, null);
    expect(v.issues).toEqual([]);
    expect(v.report.totals).toBe("ok");
  });
});

describe("ayudas de parseo", () => {
  it("montos con prefijos, signos y formatos raros", () => {
    expect(amountFromLiteral("IVA 19 %: 766.386,55")).toBe(76638655);
    expect(amountFromLiteral("$ 4.800.000,00 (IVA incluido 19)")).toBe(480000000);
    expect(amountFromLiteral("1e5")).toBeNull();
    expect(amountFromLiteral("- 37,50")).toBe(-3750);
    expect(amountFromLiteral("(37,50)")).toBe(-3750);
    expect(amountFromLiteral("4.800.000,000")).toBe(480000000);
    expect(
      amountFromLiteral(`4${String.fromCharCode(0x202f)}800${String.fromCharCode(0x202f)}000,00`),
    ).toBe(480000000);
    expect(amountFromLiteral("TOTAL:\t4.800.000,00")).toBe(480000000);
    expect(amountFromLiteral("1.234.56")).toBeNull();
  });

  it("montos con separadores de miles y decimales de cualquier convención", () => {
    expect(amountFromLiteral("4.800.000,00")).toBe(480000000);
    expect(amountFromLiteral("78,000.00")).toBe(7800000);
    expect(amountFromLiteral("TOTAL: 12.000,00 EUR")).toBe(1200000);
    expect(amountFromLiteral("2,490.00")).toBe(249000);
    expect(amountFromLiteral("120")).toBe(12000);
    expect(amountFromLiteral("4.800.000")).toBe(480000000);
    expect(amountFromLiteral("sin número")).toBeNull();
  });

  it("fechas en las tres convenciones, con ambigüedad día/mes", () => {
    expect(datesFromLiteral("Vence: 25/10/2026")).toEqual(["2026-10-25"]);
    expect(datesFromLiteral("03/04/2026")).toEqual(["2026-04-03", "2026-03-04"]);
    expect(datesFromLiteral("25 de octubre de 2026")).toEqual(["2026-10-25"]);
    expect(datesFromLiteral("October 25, 2026")).toEqual(["2026-10-25"]);
    expect(datesFromLiteral("25. Oktober 2026")).toEqual(["2026-10-25"]);
    expect(datesFromLiteral("25 de outubro de 2026")).toEqual(["2026-10-25"]);
    expect(datesFromLiteral("25/10/26")).toEqual(["2026-10-25"]);
    expect(datesFromLiteral("2026/10/25")).toEqual(["2026-10-25"]);
    expect(datesFromLiteral("31/02/2026")).toEqual([]);
    expect(datesFromLiteral("Due: 10/25/2026")).toContain("2026-10-25");
    expect(datesFromLiteral("Fällig: 11.11.2026")).toContain("2026-11-11");
    expect(datesFromLiteral("2026-10-25")).toEqual(["2026-10-25"]);
  });

  it("totales en el texto y montos en letras", () => {
    expect(
      totalsInText("Subtotal: 1,00\nTOTAL: 4.800.000,00\nTOTAL A PAGAR: 5.300.000,00 COP"),
    ).toEqual([480000000, 530000000]);
    expect(spanishWordsToNumber("cuatro millones ochocientos mil pesos")).toBe(4_800_000);
    expect(spanishWordsToNumber("setenta y ocho mil pesos 00/100 M.N.")).toBe(78_000);
    expect(spanishWordsToNumber("ciento setenta y ocho mil pesos 00/100 M.N.")).toBe(178_000);
    expect(spanishWordsToNumber("dieciocho millones de pesos")).toBe(18_000_000);
    expect(spanishWordsToNumber("mil doscientos")).toBe(1_200);
    expect(spanishWordsToNumber("un millón")).toBe(1_000_000);
    expect(spanishWordsToNumber("zwölftausend Euro")).toBeNull();
    expect(spanishWordsToNumber("mil millones de pesos")).toBe(1_000_000_000);
    expect(spanishWordsToNumber("dos mil millones")).toBe(2_000_000_000);
    expect(spanishWordsToNumber("un millón doscientos")).toBe(1_000_200);
    expect(
      spanishWordsToNumber("cuatro millones ochocientos mil pesos con cincuenta centavos"),
    ).toBe(4_800_000);
    expect(spanishWordsToNumber("cuatro millones ochocientos mil pesos M/CTE")).toBe(4_800_000);
    expect(spanishWordsToNumber("cien mil pesos colombianos")).toBe(100_000);
  });

  it("el monto en letras se busca en todas las apariciones del rótulo", () => {
    const text = "Las facturas son pagaderas a 30 días.\nSon: cien mil pesos M/CTE";
    expect(wordsAmount(text)).toBe(100_000);
    expect(wordsAmount("Sin rótulo: cien mil")).toBeNull();
  });

  it("los totales que no son el total a pagar no cuentan", () => {
    expect(totalsInText("Total horas: 80\nTotal IVA: 766.386,55\nTotal registros: 3")).toEqual([]);
    expect(totalsInText("TOTAL DUE: 2,490.00")).toEqual([249000]);
  });

  it("parsear entradas largas y repetitivas es lineal", () => {
    const started = Date.now();
    spanishWordsToNumber("0".repeat(200_000));
    wordsAmount(`Son: ${"0/".repeat(100_000)}`);
    amountFromLiteral("1.".repeat(100_000));
    totalsInText(`total ${"1 ".repeat(100_000)}`);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
