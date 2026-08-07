import { describe, expect, it } from "vitest";
import { applyEnsembleAdjudication, reconcileAIResults } from "../lib/ai-ensemble";
import type { AIExtractResult } from "../lib/ai-extractor";

const result = (overrides: Partial<AIExtractResult>): AIExtractResult => ({
  email: null,
  phone: null,
  linkedin: null,
  instagram: null,
  twitter: null,
  owners: [],
  ownerContacts: [],
  ownerResolutions: [],
  discoveryCandidates: [],
  ownershipSummary: null,
  ownershipSources: [],
  source: "none",
  citations: [],
  ...overrides,
});

describe("AI provider ensemble reconciliation", () => {
  it("selects the value supported by multiple providers while retaining minority claims", () => {
    const ensemble = reconcileAIResults([
      { provider: "perplexity", result: result({ source: "perplexity-sonar", email: "jane@example.org", citations: ["https://example.org/about"] }) },
      { provider: "gemini", result: result({ source: "gemini-flash", email: "jane@example.org", citations: ["https://news.example.net/profile"] }) },
      { provider: "tavily", result: result({ source: "tavily", email: "other@example.org", citations: ["https://other.example.com/page"] }) },
    ]);

    expect(ensemble.selected.email).toBe("jane@example.org");
    expect(ensemble.agreement.email).toBe(2);
    expect(ensemble.claims).toHaveLength(2);
    expect(ensemble.disagreements.email).toEqual(["jane@example.org", "other@example.org"]);
    expect(ensemble.claims.find((claim) => claim.value === "jane@example.org")?.sourceDomains)
      .toEqual(["example.org", "news.example.net"]);
  });

  it("does not treat repeated provider labels as canonical corroboration", () => {
    const ensemble = reconcileAIResults([
      { provider: "perplexity", result: result({ source: "perplexity-sonar", phone: "+1 212 555 0101", citations: ["https://same.example/page"] }) },
      { provider: "gemini", result: result({ source: "gemini-flash", phone: "+1 (212) 555-0101", citations: ["https://same.example/contact"] }) },
    ]);

    expect(ensemble.agreement.phone).toBe(2);
    expect(ensemble.claims[0]?.sourceDomains).toEqual(["same.example"]);
    expect(ensemble.claims[0]?.confidence).toBe(75);
  });

  it("allows adjudication to choose only a discovered claim", () => {
    const ensemble = reconcileAIResults([
      { provider: "perplexity", result: result({ source: "perplexity-sonar", email: "jane@example.org" }) },
      { provider: "gemini", result: result({ source: "gemini-flash", email: "other@example.org" }) },
    ]);
    const selected = applyEnsembleAdjudication(
      ensemble,
      result({ source: "groq", email: "other@example.org" }),
    );
    expect(selected.selected.email).toBe("other@example.org");
    expect(selected.adjudicator?.source).toBe("groq");

    const cannotInvent = applyEnsembleAdjudication(
      ensemble,
      result({ source: "groq", email: "invented@example.org" }),
    );
    expect(cannotInvent.selected.email).toBe("jane@example.org");
    expect(cannotInvent.claims.map((claim) => claim.value)).not.toContain("invented@example.org");
  });
});