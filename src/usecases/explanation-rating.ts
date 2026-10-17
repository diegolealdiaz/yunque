import { z } from "zod";

import type { Database } from "@/src/db/client";
import { appendEvent, getLatestDecision, listEvents } from "@/src/db/repositories";
import type { Actor, Ulid, UlidGenerator } from "@/src/domain";

import { UseCaseError } from "./errors";

/**
 * "¿Fue clara la explicación?" (docs/interfaz.md §3 y §5.2): la persona que lee una
 * decisión dice si la explicación se entendió, con un comentario opcional. Queda en la
 * bitácora como evento, sin tocar la decisión, y alimenta la mejora de las plantillas.
 * Se opina sobre la decisión vigente; opinar otra vez deja la opinión nueva como la que
 * cuenta, sin borrar la anterior.
 */

export const ExplanationRatingSchema = z.strictObject({
  clear: z.boolean(),
  /** Comentario libre de quien opina. Es texto no confiable: se guarda y se muestra escapado. */
  comment: z.string().trim().max(500).optional(),
});
export type ExplanationRating = z.infer<typeof ExplanationRatingSchema>;

export type RateExplanationInput = {
  readonly organizationId: Ulid;
  readonly invoiceId: Ulid;
  readonly decisionId: Ulid;
  readonly rating: ExplanationRating;
  readonly actor: Actor;
  readonly newId: UlidGenerator;
  readonly now: Date;
};

/** Guarda la opinión. Falla con `UseCaseError` si la decisión no es la vigente de la factura. */
export async function rateExplanation(db: Database, input: RateExplanationInput): Promise<void> {
  const rating = ExplanationRatingSchema.parse(input.rating);
  const latest = await getLatestDecision(db, input.organizationId, input.invoiceId);
  if (latest?.id !== input.decisionId) {
    throw new UseCaseError("decision_changed", "La factura tiene una decisión más nueva.", {
      action: "Recarga la página y opina sobre la explicación vigente.",
    });
  }
  const id = input.newId();
  await appendEvent(db, {
    id,
    organization_id: input.organizationId,
    type: "explanation.rated",
    actor: input.actor,
    invoice_id: input.invoiceId,
    decision_id: input.decisionId,
    data: rating.comment
      ? { clear: rating.clear, comment: rating.comment }
      : { clear: rating.clear },
    trace_id: `tr-${id}`,
    occurred_at: input.now.toISOString(),
  });
}

/** La opinión que cuenta para una decisión: la más reciente, o null si nadie opinó. */
export async function loadExplanationRating(
  db: Database,
  organizationId: Ulid,
  invoiceId: Ulid,
  decisionId: Ulid,
): Promise<ExplanationRating | null> {
  const events = await listEvents(db, organizationId, {
    invoiceId,
    type: "explanation.rated",
    limit: 50,
  });
  const latest = events.find((event) => event.decision_id === decisionId);
  if (!latest) return null;
  const parsed = ExplanationRatingSchema.safeParse(latest.data);
  return parsed.success ? parsed.data : null;
}
