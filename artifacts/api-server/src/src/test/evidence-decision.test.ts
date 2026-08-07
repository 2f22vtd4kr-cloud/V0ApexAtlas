import { describe, expect, it } from "vitest";
import { decideEvidence } from "../lib/evidence-decision";

describe("evidence decisions", () => {
  it("retains strong attributable claims as supported", () => {
    expect(decideEvidence({ confidence: 0.82, sourceName: "FAA", sourceReliability: 0.88 })).toEqual({
      status: "supported",
      rejectionReason: null,
    });
  });

  it("retains conflicts as disputed instead of dropping them", () => {
    const result = decideEvidence({
      confidence: 0.8,
      sourceName: "Registry comparison",
      conflictReason: "Two registries disagree on the controlling entity.",
    });
    expect(result.status).toBe("disputed");
    expect(result.rejectionReason).toMatch(/disagree/);
  });

  it("marks unattributed assertions rejected with a reason", () => {
    const result = decideEvidence({ confidence: 0.9, sourceName: null, attributable: false });
    expect(result.status).toBe("rejected");
    expect(result.rejectionReason).toMatch(/attributable/);
  });
});