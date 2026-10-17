import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ApprovalChecklist } from "@/app/_components/approval-checklist";
import { ConfidenceDot } from "@/app/_components/confidence-dot";
import { DataTable } from "@/app/_components/data-table";
import { segmentText } from "@/app/_components/document-viewer";
import { EmptyState, ErrorState } from "@/app/_components/states";
import { Timeline } from "@/app/_components/timeline";
import { VerdictChip } from "@/app/_components/verdict-chip";
import { RULE_SHORT_LABEL } from "@/src/ui/labels";
import { FindingCodeSchema } from "@/src/domain";

/**
 * Los componentes base renderizados en el servidor, como los ve el navegador al cargar.
 * Comprueban lo que no depende del navegador: escape del contenido del documento (P-110),
 * checklist inactivo hasta completarse, y texto que acompaña siempre al color.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined }),
  usePathname: () => "/",
}));

const HOSTILE = "<img src=x onerror=alert(1)>";

describe("componentes base (P-100, P-110)", () => {
  it("las tablas con columnas sin título visible no generan avisos de React", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderToStaticMarkup(
      <DataTable
        caption="x"
        columns={[
          { header: "Estado", hideHeader: true },
          { header: "Beneficiario" },
          { header: "Acción", hideHeader: true },
        ]}
        rows={[{ key: "1", cells: ["!", "Nube Andina SAS", "Revisar"] }]}
      />,
    );
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("el chip de veredicto lleva icono, texto y la regla; el detalle es accesible por foco", () => {
    const rule = {
      code: "bank_account_mismatch",
      observed: "****4471",
      threshold: "****9023",
    } as const;
    const html = renderToStaticMarkup(
      <VerdictChip verdict="escalar" rule={rule} policyVersion={4} focusable />,
    );
    expect(html).toContain("ESCALAR");
    expect(html).toContain("cuenta no coincide");
    expect(html).toContain('role="tooltip"');
    expect(html).toContain('tabindex="0"');
    expect(html).toMatch(/política v(<!-- -->)?4/);
  });

  it("dentro de una tabla el chip no es parada de tabulación y el detalle va como texto", () => {
    const rule = {
      code: "bank_account_mismatch",
      observed: "****4471",
      threshold: "****9023",
    } as const;
    const html = renderToStaticMarkup(<VerdictChip verdict="escalar" rule={rule} />);
    expect(html).not.toContain("tabindex");
    expect(html).not.toContain('role="tooltip"');
    expect(html).toContain('class="sr-only"');
    expect(html).toMatch(/observado (<!-- -->)?\*{4}4471/);
  });

  it("todo código de hallazgo tiene etiqueta corta", () => {
    for (const code of FindingCodeSchema.options)
      expect(RULE_SHORT_LABEL[code].length).toBeGreaterThan(3);
  });

  it("P-110 un beneficiario hostil se muestra como texto literal, nunca como HTML", () => {
    const html = renderToStaticMarkup(
      <>
        <VerdictChip
          verdict="escalar"
          rule={{ code: "payee_not_allowed", observed: HOSTILE, threshold: "lista" }}
        />
        <DataTable
          caption="prueba"
          columns={[{ header: "Beneficiario" }]}
          rows={[{ key: "1", cells: [<span key="p">{HOSTILE}</span>] }]}
        />
        <Timeline
          timeZone="America/Bogota"
          entries={[{ id: "1", at: "2026-10-17T14:00:00.000Z", label: HOSTILE, actor: HOSTILE }]}
        />
        <EmptyState title={HOSTILE} />
      </>,
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("el botón Aprobar arranca inactivo mientras falte marcar el checklist", () => {
    const html = renderToStaticMarkup(
      <ApprovalChecklist
        items={[{ code: "general", text: "Revisé el documento", checked: false }]}
        signature="doc 3f9a…, política v4"
      />,
    );
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Aprobar<\/button>/);
    expect(html).toContain('name="check"');
    expect(html).toContain("Faltan 1 punto por marcar");
    expect(html).toContain("Firma: doc 3f9a…, política v4");
    const done = renderToStaticMarkup(
      <ApprovalChecklist
        items={[{ code: "general", text: "Revisé el documento", checked: true }]}
        signature="x"
        formAction={() => undefined}
      />,
    );
    expect(done).not.toMatch(/disabled=""[^>]*>Aprobar/);
  });

  it("la tabla expone encabezados, foco itinerante y una sola fila tabulable", () => {
    const html = renderToStaticMarkup(
      <DataTable
        caption="Facturas"
        columns={[{ header: "Beneficiario" }, { header: "Monto", align: "right" }]}
        rows={[
          { key: "1", href: "/a", cells: ["Nube Andina SAS", "4.800.000,00 COP"] },
          { key: "2", href: "/b", cells: ["Camila Rojas", "7.600.000,00 COP"] },
        ]}
      />,
    );
    expect(html).toContain('<caption class="sr-only">Facturas</caption>');
    expect(html.match(/scope="col"/g)).toHaveLength(2);
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html.match(/tabindex="-1"/g)).toHaveLength(1);
  });

  it("una tabla vacía muestra el estado vacío que la confirma", () => {
    const html = renderToStaticMarkup(
      <DataTable
        caption="x"
        columns={[{ header: "A" }]}
        rows={[]}
        empty={<EmptyState title="Nada pendiente" />}
      />,
    );
    expect(html).toContain("Nada pendiente");
    expect(html).not.toContain("<table");
  });

  it("el punto de confianza distingue baja y suficiente por forma y texto, no solo por color", () => {
    const low = renderToStaticMarkup(<ConfidenceDot confidence={0.6} minimum={0.85} />);
    const ok = renderToStaticMarkup(<ConfidenceDot confidence={0.97} minimum={0.85} />);
    expect(low).toContain("confianza baja");
    expect(low).toContain("border-2");
    expect(ok).toContain("confianza suficiente");
  });

  it("el error dice causa y salida y se anuncia", () => {
    const html = renderToStaticMarkup(
      <ErrorState title="No se pudo leer" cause="Está borroso." action="Súbelo de nuevo." />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Súbelo de nuevo.");
  });

  it("el visor marca la primera aparición de cada cita sin solaparlas", () => {
    const segments = segmentText("TOTAL: 4.800.000,00 COP Cuenta: 31245679023", [
      { id: "total", label: "Monto", quote: "4.800.000,00", page: 1, box: null },
      { id: "cuenta", label: "Cuenta", quote: "31245679023", page: 1, box: null },
      { id: "ausente", label: "Otro", quote: "no está", page: 1, box: null },
    ]);
    expect(segments.map((s) => [s.text, s.highlight?.id ?? null])).toEqual([
      ["TOTAL: ", null],
      ["4.800.000,00", "total"],
      [" COP Cuenta: ", null],
      ["31245679023", "cuenta"],
    ]);
  });
});
