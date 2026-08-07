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
 *
 * The inputs deliberately describe evidence quality, not just record volume.
 * Registry labels, provider counts, assets, and graph degree are useful
 * retrieval context, but cannot by themselves promote identity, ownership,
 * contact, or access.
 */
export function computeResearchScorecard(input: {
  wealthEvidenceScore: number;
  identitySourceCount: number;
  identityCorroboratingDomainCount: number;
  identityAttributionConfidence?: number;
  ownershipSourceCount: number;
  ownershipCorroboratingDomainCount: number;
  ownershipEvidenceQuality?: number;
  validatedContactEvidenceCount: number;
  verifiedDirectRouteCount: number;
  contactIndependentDomainCount: number;
  contactEvidenceQuality?: number;
  reachabilityScore: number;
  sourceIndependentDomainCount: number;
  sourceReliabilityAverage?: number;
  daysSinceActivity: number;
  hasRecentActivity: boolean;
  evidenceFreshnessScore?: number;
}): ResearchScorecard {
  const identity = clamp(
    Math.min(0.45, Math.max(0, input.identitySourceCount) * 0.15) +
      Math.min(0.35, Math.max(0, input.identityCorroboratingDomainCount) * 0.12) +
      0.2 * clamp(input.identityAttributionConfidence ?? 0),
  );
  const ownership = clamp(
    Math.min(0.4, Math.max(0, input.ownershipSourceCount) * 0.16) +
      Math.min(0.35, Math.max(0, input.ownershipCorroboratingDomainCount) * 0.12) +
      0.25 * clamp(input.ownershipEvidenceQuality ?? 0),
  );
  const directRouteEvidence = Math.min(0.55, Math.max(0, input.verifiedDirectRouteCount) * 0.55);
  const validatedEvidence = input.validatedContactEvidenceCount > 0 ? 0.2 : 0;
  const contact = clamp(
    directRouteEvidence +
      Math.min(0.25, Math.max(0, input.contactIndependentDomainCount) * 0.08) +
      validatedEvidence +
      0.2 * clamp(input.contactEvidenceQuality ?? 0),
  );
  const access = clamp(input.reachabilityScore / 100);
  const wealth = clamp(input.wealthEvidenceScore);
  const activityFreshness = input.hasRecentActivity
    ? 1
    : clamp(1 - Math.max(0, input.daysSinceActivity - 180) / 720);
  const freshness = clamp(
    activityFreshness * 0.6 + 0.4 * clamp(input.evidenceFreshnessScore ?? activityFreshness),
  );
  const sourceQuality = clamp(
    (Math.min(0.6, Math.max(0, input.sourceIndependentDomainCount) * 0.2) +
      (input.sourceIndependentDomainCount >= 2 ? 0.25 : input.sourceIndependentDomainCount > 0 ? 0.1 : 0)) *
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