import { describe, expect, it } from "vitest";
import { deriveIntroPathCandidate } from "../lib/intro-path-candidate";

describe("intro path candidate scaffold export", () => {
  it("exposes the production helper without changing contact state", () => {
    const candidate = deriveIntroPathCandidate(
      { id: 1, name: "Example", type: "HNWI" },
      [{
        vectorType: "phone",
        value: "+441234567890",
        source: "Public office page",
        sourceUrl: "https://example.org/contact",
        validationStatus: "candidate",
        metadata: JSON.stringify({ scope: "organization" }),
      }],
    );
    expect(candidate?.status).toBe("review_required");
    expect(candidate?.routeKind).toBe("organization_route");
  });
});