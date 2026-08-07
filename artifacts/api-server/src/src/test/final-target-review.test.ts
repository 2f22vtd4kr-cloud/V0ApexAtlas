import { describe, expect, it } from "vitest";
import {
  adjudicateFinalTargetReview,
  deriveTargetResearchDisposition,
  type FinalTargetReviewInput,
} from "../lib/final-target-review";

const baseInput = (overrides: Partial<FinalTargetReviewInput> = {}): FinalTargetReviewInput => ({
  targetName: "Jane Example",
  targetType: "HNWI",
  proposedContacts: { email: "jane@example.org", phone: null, linkedin: null, instagram: null, twitter: null },
  candidates: [{
    key: "email|jane@example.org",
    vectorType: "email",
    value: "jane@example.org",
    providers: ["web"],
    sourceDomains: ["example.org"],
    sourceUrls: ["https://example.org/contact"],
    scopes: ["target_person"],
    personNames: ["Jane Example"],
    state: "verified_direct_route",
    conflictCount: 0,
    exactClaimObserved: true,
    blockedSourceUrls: [],
  }],
  evidence: [{
    vectorType: "email",
    value: "jane@example.org",
    source: "web",
    sourceUrl: "https://example.org/contact",
    validationStatus: "candidate",
  }],
  proposedAssets: [{
    category: "Business",
    identifier: "Example Holdings",
    jurisdiction: "UK",
    description: "Observed business identifier",
  }],
  ...overrides,
});

describe("final target review", () => {
  it("cannot approve an invented contact or asset", () => {
    const result = adjudicateFinalTargetReview(baseInput(), {
      decision: "publish",
      approvedContactValues: ["invented@example.org"],
      approvedAssetIdentifiers: ["Invented Holdings"],
    }, "test");

    expect(result.decision).toBe("review");
    expect(result.approvedContactValues).toEqual([]);
    expect(result.approvedAssetIdentifiers).toEqual([]);
  });

  it("accepts only an exact, attributed, conflict-free current candidate", () => {
    const result = adjudicateFinalTargetReview(baseInput(), {
      decision: "publish",
      approvedContactValues: ["jane@example.org"],
      approvedAssetIdentifiers: ["Example Holdings"],
      reasons: ["Exact claim page observed."],
    }, "test");

    expect(result.decision).toBe("publish");
    expect(result.approvedContactValues).toEqual(["jane@example.org"]);
    expect(result.approvedAssetIdentifiers).toEqual(["Example Holdings"]);
  });

  it("downgrades research-only targets even when a model tries to publish", () => {
    const result = adjudicateFinalTargetReview(
      baseInput({ reachabilityStatus: "research_only" }),
      {
        decision: "publish",
        approvedContactValues: ["jane@example.org"],
        approvedAssetIdentifiers: ["Example Holdings"],
      },
      "test",
    );

    // The asset is still an exact supplied value, so it may be retained as
    // research evidence; no contact can be promoted for a research-only target.
    expect(result.approvedContactValues).toEqual([]);
    expect(result.decision).toBe("publish");
    expect(result.approvedAssetIdentifiers).toEqual(["Example Holdings"]);
  });

  it("keeps a zero-yield review explicitly retryable", () => {
    const disposition = deriveTargetResearchDisposition({
      approvedContactValues: [],
    });

    expect(disposition.disposition).toBe("needs_follow_up");
    expect(disposition.nextAction).toContain("another target-scoped OSINT pass");
  });

  it("marks an approved route as a completed research outcome", () => {
    const disposition = deriveTargetResearchDisposition({
      approvedContactValues: ["jane@example.org"],
    });

    expect(disposition.disposition).toBe("contact_route_found");
    expect(disposition.nextAction).toContain("manual access review");
  });
});