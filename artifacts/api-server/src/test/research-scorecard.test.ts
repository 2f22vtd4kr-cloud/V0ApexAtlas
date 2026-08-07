import { describe, expect, it } from "vitest";
import { computeResearchScorecard } from "../lib/research-scorecard";

describe("research scorecard", () => {
  it("does not let wealth inflate access or contact", () => {
    const score = computeResearchScorecard({
      bayesianScore: 0.98,
      contactConfidence: 0,
      hasDirectContact: false,
      reachabilityScore: 8,
      assetCount: 3,
      ownershipRelationshipCount: 2,
      sourceRegistryCount: 2,
      corroboratingSourceCount: 3,
      daysSinceActivity: 20,
      hasRecentActivity: true,
    });
    expect(score.wealth).toBeGreaterThan(0.9);
    expect(score.contact).toBe(0);
    expect(score.access).toBeLessThan(0.1);
  });

  it("rewards independent sources and recent activity separately", () => {
    const score = computeResearchScorecard({
      bayesianScore: 0.5,
      contactConfidence: 80,
      hasDirectContact: true,
      reachabilityScore: 75,
      assetCount: 1,
      ownershipRelationshipCount: 4,
      sourceRegistryCount: 3,
      corroboratingSourceCount: 4,
      sourceReliabilityAverage: 0.92,
      daysSinceActivity: 10,
      hasRecentActivity: true,
    });
    expect(score.identity).toBeGreaterThan(0.8);
    expect(score.sourceQuality).toBeGreaterThan(0.8);
    expect(score.freshness).toBe(1);
  });
});