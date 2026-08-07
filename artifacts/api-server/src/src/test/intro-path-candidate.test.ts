import { describe, expect, it } from "vitest";
import { deriveIntroPathCandidate } from "../lib/intro-path-candidate";

const target = { id: 15, name: "Michael Halsall", type: "HNWI" } as const;

describe("intro path candidate", () => {
  it("returns one review-only named-person route from an exact claim", () => {
    const candidate = deriveIntroPathCandidate(target, [{
      vectorType: "email",
      value: "michael@example.org",
      source: "ClaimPage[public]",
      sourceUrl: "https://public.example.org/claim",
      validationStatus: "candidate",
      metadata: JSON.stringify({
        scope: "person_candidate",
        personName: "Michael Halsall",
        role: "director_officer",
        exactClaimObserved: true,
        sourceUrls: ["https://public.example.org/claim"],
      }),
    }]);

    expect(candidate?.status).toBe("review_required");
    expect(candidate?.routeKind).toBe("intermediary_candidate");
    expect(candidate?.route.value).toBe("michael@example.org");
    expect(candidate?.warnings.some((warning) => warning.includes("not a verified personal contact"))).toBe(true);
  });

  it("does not turn an unscoped named-person contact into an intro path", () => {
    expect(deriveIntroPathCandidate(target, [{
      vectorType: "email",
      value: "michael@example.org",
      source: "ClaimPage[public]",
      sourceUrl: "https://public.example.org/claim",
      validationStatus: "candidate",
      metadata: JSON.stringify({
        scope: "person_candidate",
        personName: "Michael Halsall",
        sourceUrls: ["https://public.example.org/claim"],
      }),
    }])).toBeNull();
  });

  it("chooses at most one route and ignores blocked lead-generation publishers", () => {
    const candidate = deriveIntroPathCandidate(target, [
      {
        vectorType: "email",
        value: "blocked@example.org",
        source: "RocketReach",
        sourceUrl: "https://rocketreach.co/person",
        validationStatus: "candidate",
        metadata: JSON.stringify({ scope: "person_candidate", personName: "Michael Halsall" }),
      },
      {
        vectorType: "phone",
        value: "+441234567890",
        source: "ClaimPage[public]",
        sourceUrl: "https://public.example.org/office",
        validationStatus: "candidate",
        metadata: JSON.stringify({ scope: "organization", sourceUrls: ["https://public.example.org/office"] }),
      },
    ]);

    expect(candidate?.route.value).toBe("+441234567890");
    expect(candidate?.evidence).toHaveLength(1);
  });

  it("returns no candidate without a usable public source URL", () => {
    expect(deriveIntroPathCandidate(target, [{
      vectorType: "email",
      value: "michael@example.org",
      source: "AI",
      sourceUrl: null,
      validationStatus: "candidate",
      metadata: JSON.stringify({ scope: "person_candidate", personName: "Michael Halsall" }),
    }])).toBeNull();
  });
});