export type IdentityGateDecision = "accepted" | "review" | "rejected";

export interface IdentityGateResult {
  decision: IdentityGateDecision;
  reason: string;
}

/**
 * A name match is never enough to create an attributable graph edge.
 * Acceptance requires an independent, stable identifier or a strongly
 * attributable profile plus cross-source corroboration.
 */
export function evaluateIdentityGate(input: {
  score: number;
  signals: string[];
  leftSources: string[];
  rightSources: string[];
}): IdentityGateResult {
  const signals = new Set(input.signals);
  const rightSources = new Set(input.rightSources.map((source) => source.toLowerCase()));
  const sourceOverlap = input.leftSources.filter((source) => rightSources.has(source.toLowerCase()));
  const crossSource = input.leftSources.length > 0 &&
    input.rightSources.length > 0 &&
    sourceOverlap.length < Math.min(input.leftSources.length, input.rightSources.length);

  if (signals.size === 0 || input.score < 0.62) {
    return { decision: "rejected", reason: "Name similarity without contextual corroboration is not attributable." };
  }
  if (!crossSource) {
    return { decision: "review", reason: "Evidence does not yet span independent source registries." };
  }
  if (
    input.score >= 0.78 &&
    (signals.has("shared_registry_identifier") ||
      signals.has("shared_asset_identifier") ||
      (signals.has("shared_public_profile") && signals.has("shared_affiliation")))
  ) {
    return { decision: "accepted", reason: "Independent sources share a stable identifier or attributable profile context." };
  }
  return { decision: "review", reason: "Context is promising but requires manual confirmation before graph use." };
}