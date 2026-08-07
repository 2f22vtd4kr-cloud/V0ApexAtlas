export interface ResearchScorecard {
  identity: number;
  ownership: number;
  contact: number;
  access: number;
  wealth: number;
  freshness: number;
  sourceQuality: number;
  overall: number;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

/**
 * Keeps distinct research questions separate. A high wealth signal must not
 * make an unverified identity or unreachable target look actionable.
 */
export function computeResearchScorecard(input: {
  bayesianScore: number;
  contactConfidence?: number | null;
  hasDirectContact: boolean;
  reachabilityScore: number;
  assetCount: number;
  ownershipRelationshipCount: number;
  sourceRegistryCount: number;
  corroboratingSourceCount: number;
  sourceReliabilityAverage?: number;
  daysSinceActivity: number;
  hasRecentActivity: boolean;
}): ResearchScorecard {
  const identity = clamp(
    (input.sourceRegistryCount > 0 ? 0.45 : 0.2) +
      Math.min(0.35, input.corroboratingSourceCount * 0.08) +
      (input.hasDirectContact ? 0.2 : 0),
  );
  const ownership = clamp(
    (input.assetCount > 0 ? 0.25 : 0) +
      Math.min(0.55, input.ownershipRelationshipCount * 0.12) +
      (input.sourceRegistryCount > 0 ? 0.2 : 0),
  );
  const contact = clamp((input.contactConfidence ?? 0) / 100);
  const access = clamp(input.reachabilityScore / 100);
  const wealth = clamp(input.bayesianScore);
  const freshness = input.hasRecentActivity
    ? 1
    : clamp(1 - Math.max(0, input.daysSinceActivity - 180) / 720);
  const sourceQuality = clamp(
    ((input.sourceRegistryCount > 0 ? 0.45 : 0.15) +
      Math.min(0.45, input.corroboratingSourceCount * 0.1)) *
      (0.65 + 0.35 * clamp(input.sourceReliabilityAverage ?? 0.3)),
  );
  const overall = clamp(
    identity * 0.2 +
      ownership * 0.15 +
      contact * 0.15 +
      access * 0.2 +
      wealth * 0.1 +
      freshness * 0.1 +
      sourceQuality * 0.1,
  );

  return { identity, ownership, contact, access, wealth, freshness, sourceQuality, overall };
}