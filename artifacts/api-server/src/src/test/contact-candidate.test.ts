import { describe, expect, it } from "vitest";
import {
  exactContactValueMatches,
  isEligiblePersonalSocialCandidate,
  isPromotableDirectContactUrl,
  reconcileContactCandidates,
  reconcileStoredContactEvidence,
} from "../lib/contact-candidate";

describe("contact candidate reconciliation", () => {
  it("matches exact fetched claim values without treating formatting as evidence", () => {
    expect(exactContactValueMatches("email", "Jane@Example.org", " jane@example.org ")).toBe(true);
    expect(exactContactValueMatches("phone", "+1 (212) 555-0101", "212.555.0101")).toBe(false);
    expect(exactContactValueMatches("phone", "+1 (212) 555-0101", "+1 212 555 0101")).toBe(true);
  });

  it("does not count lead-generation directories as canonical direct-contact publishers", () => {
    expect(isPromotableDirectContactUrl("https://contactout.com/Jane-Doe-123")).toBe(false);
    expect(isPromotableDirectContactUrl("https://signalhire.com/profiles/jane-doe")).toBe(false);
    expect(isPromotableDirectContactUrl("https://www.bbb.org/profile/jane-doe")).toBe(true);
    expect(isPromotableDirectContactUrl("https://example.org/team/jane-doe")).toBe(true);
  });

  it("retains a blocked directory contact as an explicit rejected candidate", () => {
    const funnel = reconcileContactCandidates([{
      vectorType: "email",
      value: "jane@example.org",
      source: "directory",
      sourceUrl: "https://contactout.com/Jane-Doe-123",
      details: { scope: "target_person", personName: "Jane Doe" },
    }]);
    expect(funnel.rejected).toBe(1);
    expect(funnel.candidates[0]?.state).toBe("rejected");
    expect(funnel.candidates[0]?.rejectionReason).toContain("blocked");
    expect(funnel.candidates[0]?.blockedSourceUrls).toHaveLength(1);
  });

  it("keeps an organization contact out of the personal promotion state", () => {
    const funnel = reconcileContactCandidates([
      {
        vectorType: "email",
        value: "info@example.org",
        source: "Perplexity",
        sourceUrl: "https://example.org/contact",
        details: { scope: "organization" },
      },
      {
        vectorType: "email",
        value: "info@example.org",
        source: "Gemini",
        sourceUrl: "https://news.example.net/example",
        details: { scope: "organization" },
      },
    ]);
    expect(funnel.organizationOnly).toBe(1);
    expect(funnel.candidates[0]?.state).toBe("source_linked");
    expect(funnel.candidates[0]?.state).not.toBe("verified_direct_route");
  });

  it("requires independent canonical domains, not provider agreement", () => {
    const samePublisher = reconcileContactCandidates([
      {
        vectorType: "email",
        value: "jane@example.org",
        source: "Perplexity",
        sourceUrl: "https://www.example.org/profile?utm_source=x",
        details: { scope: "target_person", personName: "Jane Doe" },
      },
      {
        vectorType: "email",
        value: "JANE@example.org",
        source: "Gemini",
        sourceUrl: "https://example.org/profile#bio",
        details: { scope: "target_person", personName: "Jane Doe" },
      },
    ]);
    expect(samePublisher.independentSourceDomains).toBe(1);
    expect(samePublisher.candidates[0]?.state).toBe("attribution_review");

    const independent = reconcileContactCandidates([
      {
        vectorType: "email",
        value: "jane@example.org",
        source: "Perplexity",
        sourceUrl: "https://example.org/profile",
        details: { scope: "target_person", personName: "Jane Doe" },
      },
      {
        vectorType: "email",
        value: "jane@example.org",
        source: "Gemini",
        sourceUrl: "https://conference.example.net/speaker",
        details: { scope: "target_person", personName: "Jane Doe" },
      },
    ]);
    expect(independent.candidates[0]?.state).toBe("verified_direct_route");
    expect(independent.candidates[0]?.sourceDomains).toHaveLength(2);
  });

  it("does not call independent publishers a same-publisher conflict", () => {
    const funnel = reconcileContactCandidates([
      {
        vectorType: "phone",
        value: "+1 212 555 0101",
        source: "official",
        sourceUrl: "https://example.org/team",
        details: { scope: "target_person", personName: "Jane Doe" },
      },
      {
        vectorType: "phone",
        value: "+1 212 555 0199",
        source: "press",
        sourceUrl: "https://press.example.net/interview",
        details: { scope: "target_person", personName: "Jane Doe" },
      },
    ]);
    expect(funnel.candidates).toHaveLength(2);
    expect(funnel.conflicted).toBe(0);
    expect(funnel.candidates.every((candidate) => candidate.conflictCount === 0)).toBe(true);
  });

  it("preserves same-publisher contradictory values as conflicts", () => {
    const funnel = reconcileContactCandidates([
      {
        vectorType: "phone",
        value: "+1 212 555 0101",
        source: "official",
        sourceUrl: "https://example.org/team",
        details: { scope: "target_person", personName: "Jane Doe" },
      },
      {
        vectorType: "phone",
        value: "+1 212 555 0199",
        source: "official",
        sourceUrl: "https://example.org/contact",
        details: { scope: "target_person", personName: "Jane Doe" },
      },
    ]);
    expect(funnel.conflicted).toBe(2);
    expect(funnel.candidates.every((candidate) => candidate.conflictCount === 1)).toBe(true);
  });

  it("blocks organization-only and uncorroborated same-name social candidates", () => {
    const organization = reconcileContactCandidates([{
      vectorType: "social",
      value: "https://instagram.com/company-account",
      source: "directory",
      sourceUrl: "https://company.example/contact",
      details: { scope: "organization" },
    }]).candidates[0]!;
    const sameName = reconcileContactCandidates([{
      vectorType: "social",
      value: "https://instagram.com/jane-doe",
      source: "search",
      sourceUrl: "https://unrelated.example/profile",
      details: { scope: "person_candidate", personName: "Jane Doe" },
    }]).candidates[0]!;

    expect(isEligiblePersonalSocialCandidate(organization)).toBe(false);
    expect(isEligiblePersonalSocialCandidate(sameName)).toBe(false);
    expect(organization.state).toBe("rejected");
    expect(organization.rejectionReason).toContain("organization-only");
  });

  it("matches social claims by normalized profile URL and requires fetched-claim metadata", () => {
    expect(exactContactValueMatches(
      "social",
      "https://www.instagram.com/jane-doe/?utm_source=search",
      "https://instagram.com/jane-doe",
    )).toBe(true);
    const withoutFetch = reconcileContactCandidates([{
      vectorType: "social",
      value: "https://instagram.com/jane-doe",
      source: "search",
      sourceUrl: "https://press.example.org/jane",
      details: { scope: "target_person", personName: "Jane Doe" },
    }]).candidates[0]!;
    expect(withoutFetch.exactClaimObserved).toBe(false);
    expect(isEligiblePersonalSocialCandidate(withoutFetch)).toBe(false);
  });

  it("allows a corroborated person candidate to become a research pivot", () => {
    const candidate = reconcileContactCandidates([
      {
        vectorType: "social",
        value: "https://instagram.com/jane-doe",
        source: "press",
        sourceUrl: "https://press.example.org/jane-doe",
        details: { scope: "person_candidate", personName: "Jane Doe", exactClaimObserved: true },
      },
      {
        vectorType: "social",
        value: "https://instagram.com/jane-doe",
        source: "registry",
        sourceUrl: "https://registry.example.net/person/jane-doe",
        details: { scope: "person_candidate", personName: "Jane Doe", exactClaimObserved: true },
      },
    ]).candidates[0]!;

    expect(candidate.state).toBe("independently_corroborated");
    expect(isEligiblePersonalSocialCandidate(candidate)).toBe(true);
  });

  it("reconstructs the same funnel from historical evidence rows", () => {
    const funnel = reconcileStoredContactEvidence([
      {
        id: 1,
        vectorType: "email",
        value: "jane@example.org",
        source: "directory",
        sourceUrl: "https://contactout.com/Jane-Doe-123",
        metadata: JSON.stringify({ scope: "target_person", personName: "Jane Doe" }),
      },
      {
        id: 2,
        vectorType: "social",
        value: "https://instagram.com/jane-doe",
        source: "claim-page",
        sourceUrl: "https://press.example.org/jane",
        metadata: JSON.stringify({
          scope: "target_person",
          personName: "Jane Doe",
          exactClaimObserved: true,
        }),
      },
    ]);
    expect(funnel.totalCandidates).toBe(2);
    expect(funnel.rejected).toBe(1);
    expect(funnel.candidates.find((candidate) => candidate.vectorType === "email")?.state).toBe("rejected");
    expect(funnel.candidates.find((candidate) => candidate.vectorType === "social")?.exactClaimObserved).toBe(true);
  });
});