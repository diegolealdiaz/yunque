/**
 * Punto de confianza de un campo leído. Por encima del mínimo de la política es un punto
 * lleno verde; por debajo, un anillo ámbar, porque ese campo hace escalar la factura.
 * La forma distingue los dos casos sin depender del color, y el valor exacto va en el
 * texto accesible y al pasar el ratón.
 */
export function ConfidenceDot({
  confidence,
  minimum,
}: {
  readonly confidence: number;
  /** Mínimo de la política (`field_low_confidence.min_confidence`). */
  readonly minimum: number;
}) {
  const low = confidence < minimum;
  const value = confidence.toFixed(2);
  return (
    <span
      className="inline-flex items-center gap-1.5 font-mono text-[11px] text-ink-3"
      title={`Confianza ${value}`}
    >
      <span
        aria-hidden="true"
        className={
          low
            ? "size-2.5 rounded-full border-2 border-escalate-solid"
            : "size-2 rounded-full bg-pay-solid"
        }
      />
      <span className="num">{value}</span>
      <span className="sr-only">{low ? "confianza baja" : "confianza suficiente"}</span>
    </span>
  );
}
