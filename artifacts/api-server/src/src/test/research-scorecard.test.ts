import { describe, expect, it } from "vitest";
import { computeResearchScorecard } from "../lib/research-scorecard";

describe("research scorecard", () => {
  it("does not let wealth inflate access or contact", () => {
    const score = computeResearchScorecard({
      wealthEvidenceScore: 0.98,
      identitySourceCount: 2,
      identityCorroboratingDomainCount: 0,
      ownershipSourceCount: 2,
      ownershipCorroboratingDomainCount: 0,
      validatedContactEvidenceCount: 0,
      verifiedDirectRouteCount: 0,
      contactIndependentDomainCount: 0,
      reachabilityScore: 8,
      sourceIndependentDomainCount: 0,
      daysSinceActivity: 20,
      hasRecentActivity: true,
    });
    expect(score.wealth).toBeGreaterThan(0.9);
    expect(score.contact).toBe(0);
    expect(score.access).toBeLessThan(0.1);
    expect(score.identity).toBeLessThan(0.5);
    expect(score.ownership).toBeLessThan(0.5);
  });

  it("rewards independent sources and recent activity separately", () => {
    const score = computeResearchScorecard({
      wealthEvidenceScore: 0.5,
      identitySourceCount: 3,
      identityCorroboratingDomainCount: 3,
      identityAttributionConfidence: 1,
      ownershipSourceCount: 3,
      ownershipCorroboratingDomainCount: 3,
      ownershipEvidenceQuality: 0.95,
      validatedContactEvidenceCount: 2,
      verifiedDirectRouteCount: 1,
      contactIndependentDomainCount: 3,
      contactEvidenceQuality: 0.9,
      reachabilityScore: 75,
      sourceIndependentDomainCount: 3,
      sourceReliabilityAverage: 0.92,
      daysSinceActivity: 10,
      hasRecentActivity: true,
      evidenceFreshnessScore: 0.95,
    });
    expect(score.identity).toBeGreaterThan(0.8);
    expect(score.ownership).toBeGreaterThan(0.8);
    expect(score.contact).toBeGreaterThan(0.8);
    expect(score.sourceQuality).toBeGreaterThan(0.8);
    expect(score.freshness).toBeGreaterThan(0.9);
    expect(score.freshness).toBeLessThan(1);
  });

  it("is stable across reruns and does not compound a prior posterior", () => {
    const input = {
      wealthEvidenceScore: 0.72,
      identitySourceCount: 2,
      identityCorroboratingDomainCount: 2,
      identityAttributionConfidence: 0.8,
      ownershipSourceCount: 2,
      ownershipCorroboratingDomainCount: 2,
      ownershipEvidenceQuality: 0.8,
      validatedContactEvidenceCount: 1,
      verifiedDirectRouteCount: 0,
      contactIndependentDomainCount: 2,
      contactEvidenceQuality: 0.7,
      reachabilityScore: 40,
      sourceIndependentDomainCount: 2,
      sourceReliabilityAverage: 0.8,
      daysSinceActivity: 90,
      hasRecentActivity: true,
      evidenceFreshnessScore: 0.8,
    } as const;
    expect(computeResearchScorecard(input)).toEqual(computeResearchScorecard(input));
  });
});