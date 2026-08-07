import { describe, expect, it } from "vitest";
import { decideResearchCascade } from "../lib/research-cascade";

describe("adaptive research cascade", () => {
  it("stops broad critic search when a validated direct route is sufficient", () => {
    const decision = decideResearchCascade({
      hybridCandidates: 15,
      independentSources: 3,
      hasDirectContact: true,
      hasGatekeeperPath: false,
      pathNodes: 1,
      identityScore: 0.9,
      accessScore: 0.8,
      requestedDepth: 4,
    });
    expect(decision.runCritic).toBe(false);
    expect(decision.reason).toMatch(/direct route/i);
  });

  it("keeps the expensive critic stage for sparse evidence", () => {
    const decision = decideResearchCascade({
      hybridCandidates: 0,
      independentSources: 0,
      hasDirectContact: false,
      hasGatekeeperPath: false,
      pathNodes: 1,
      identityScore: 0.3,
      accessScore: 0.05,
      requestedDepth: 4,
    });
    expect(decision.runCritic).toBe(true);
  });
});