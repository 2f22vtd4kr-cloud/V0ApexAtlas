export type TemporalState = "current" | "aging" | "stale" | "unknown";

const DAY_MS = 86_400_000;

function asTime(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

/**
 * Evidence freshness is explicit and bounded. A missing date is unknown, not
 * fresh; a future observation is capped at the current moment.
 */
export function computeFreshnessScore(
  observedAt: Date | string | null | undefined,
  now = new Date(),
  halfLifeDays = 180,
): number {
  const observed = asTime(observedAt);
  if (observed === null) return 0;
  const ageDays = Math.max(0, (now.getTime() - Math.min(observed, now.getTime())) / DAY_MS);
  return Math.max(0, Math.min(1, Math.pow(0.5, ageDays / Math.max(1, halfLifeDays))));
}

export function classifyTemporalState(
  observedAt: Date | string | null | undefined,
  now = new Date(),
  halfLifeDays = 180,
): TemporalState {
  const score = computeFreshnessScore(observedAt, now, halfLifeDays);
  if (score === 0) return observedAt ? "stale" : "unknown";
  if (score >= 0.7) return "current";
  if (score >= 0.35) return "aging";
  return "stale";
}

export function isValidAt(
  validFrom: Date | string | null | undefined,
  validTo: Date | string | null | undefined,
  at = new Date(),
): boolean {
  const time = at.getTime();
  const from = asTime(validFrom);
  const to = asTime(validTo);
  return (from === null || from <= time) && (to === null || to >= time);
}