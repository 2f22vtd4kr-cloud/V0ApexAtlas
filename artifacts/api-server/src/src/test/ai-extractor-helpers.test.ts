import { describe, expect, it } from "vitest";
import { buildPerplexityPrompt, buildProviderSearchQuery, extractJsonObject } from "../lib/ai-extractor";

describe("AI response safety helpers", () => {
  it("extracts the first balanced JSON object instead of greedily merging objects", () => {
    const raw = '```json\n{"email":"first@example.org","nested":{"ok":true}}\n```\n{"ignored":true}';
    expect(extractJsonObject(raw)).toBe('{"email":"first@example.org","nested":{"ok":true}}');
  });

  it("handles braces inside quoted strings", () => {
    expect(extractJsonObject('prefix {"basis":"text with } brace","email":null} suffix'))
      .toBe('{"basis":"text with } brace","email":null}');
  });

  it("unwraps provider JSON strings and decodes HTML-escaped punctuation", () => {
    const raw = JSON.stringify('{ "ownershipSummary": "Michael &amp; Co.", "email": null }');
    expect(extractJsonObject(raw)).toBe('{ "ownershipSummary": "Michael & Co.", "email": null }');
  });

  it("rejects incomplete or non-object responses", () => {
    expect(extractJsonObject("not json")).toBeNull();
    expect(extractJsonObject('{"email":"broken"')).toBeNull();
  });

  it("does not ask person research for a general organization email", () => {
    const prompt = buildPerplexityPrompt("Jane Doe", "HNWI", "US");
    expect(prompt).toContain("personal/direct email for the named individual only");
    expect(prompt).not.toContain('"email": "general org contact email or null"');
    expect(prompt).toContain('"instagram": "personal Instagram URL or null"');
    expect(prompt).not.toContain('"instagram": "org Instagram URL or null"');
    expect(prompt).toContain("corporate headquarters number");
  });

  it("keeps organization email wording scoped to organization research", () => {
    const prompt = buildPerplexityPrompt("Example Holdings", "Corporation", "US");
    expect(prompt).toContain('"email": "general organization contact email or null"');
    expect(prompt).toContain('"instagram": "organization Instagram URL or null"');
    expect(prompt).not.toContain("personal/direct email for the named individual only");
  });

  it("requires identity anchors and claim-level evidence before promoting findings", () => {
    const prompt = buildPerplexityPrompt("Example Holdings", "Corporation", "US", { city: "New York" });
    expect(prompt).toContain("target fingerprint first");
    expect(prompt).toContain("at least two independent anchors");
    expect(prompt).toContain("claim-level provenance");
    expect(prompt).toContain("Reject entity drift");
    expect(prompt).toContain("A username match, email-platform presence");
    expect(prompt).toContain('"identityAssessment": "confirmed | probable | ambiguous | not_established"');
    expect(prompt).toContain('"negativeFindings"');
    expect(prompt).toContain('"searchGaps"');
  });

  it("passes target-record anchors into the prompt without treating them as proof", () => {
    const prompt = buildPerplexityPrompt("Example Holdings", "Corporation", "US", {
      city: "New York",
      anchors: ["source registry: EDGAR", "cik: 0000123456"],
      candidateDomains: ["exampleholdings.com"],
      lane: "official_records",
    });
    expect(prompt).toContain("source registry: EDGAR");
    expect(prompt).toContain("cik: 0000123456");
    expect(prompt).toContain("Candidate domains surfaced by the pipeline");
    expect(prompt).toContain("official team/people pages, filings, registries");
    expect(prompt).toContain("they are not independently verified evidence");
  });

  it("passes explicit operator leads into provider queries", () => {
    const query = buildProviderSearchQuery("Amaron Helsingborg Topasen 7 AB", "Corporation", "SE", {
      tradingName: "Amaron Helsingborg Topasen 7",
      relatedOrganizations: ["Amaron Real Estate AB"],
      lane: "semantic_discovery",
    });
    expect(query).toContain('"Amaron Real Estate AB"');
    expect(query).toContain("ownership control parent operating company principal");
  });

  it("requires parent/operator expansion for property and holding vehicles", () => {
    const prompt = buildPerplexityPrompt("Amaron Helsingborg Topasen 7 AB", "Corporation", "SE", {
      city: "Helsingborg",
      lane: "contact_routes",
      anchors: ["source registry: GLEIF LEI Register", "lei: 636700UQP96H853NEX42"],
    });
    expect(prompt).toContain("special-purpose, property, holding, or zero-employee vehicle");
    expect(prompt).toContain("official parent/operator team and contact pages");
    expect(prompt).toContain("STEP 0 — CORPORATE-STRUCTURE HANDOFF");
    expect(prompt).toContain("named executives of an explicitly linked parent/operator group");
  });

  it("builds lane-specific, anchored provider queries", () => {
    const query = buildProviderSearchQuery("Example Holdings", "Corporation", "US", {
      tradingName: "Example",
      city: "New York",
      anchors: ["cik: 0000123456"],
      candidateDomains: ["exampleholdings.com"],
      lane: "official_records",
    });
    expect(query).toContain('"Example Holdings"');
    expect(query).toContain('"Example"');
    expect(query).toContain('"New York"');
    expect(query).toContain("cik: 0000123456");
    expect(query).toContain("official team people registry filing");
    expect(query).toContain("site:exampleholdings.com");
  });

  it("includes subject kind and disambiguation notes in provider queries", () => {
    const query = buildProviderSearchQuery("Orient Express", "Corporation", "FR", {
      subjectKind: "brand",
      disambiguationNotes: [
        "brand/platform subject; do not collapse related legal entities",
        "related organizations are leads to verify, not automatic ownership proof",
      ],
      lane: "official_records",
    });
    expect(query).toContain("subject:brand");
    expect(query).toContain('"brand/platform subject; do not collapse related legal entities"');
    expect(query).toContain("official team people registry filing");
  });

  it("keeps brand disambiguation explicit in the research prompt", () => {
    const prompt = buildPerplexityPrompt("Orient Express", "Corporation", "FR", {
      subjectKind: "brand",
      disambiguationNotes: ["Venice Simplon-Orient-Express / Belmond is a separate related subject"],
    });
    expect(prompt).toContain("Target subject kind: brand");
    expect(prompt).toContain("Venice Simplon-Orient-Express / Belmond is a separate related subject");
  });

  it("requests a broad named-person set without relaxing evidence requirements", () => {
    const prompt = buildPerplexityPrompt("Example Holdings", "Corporation", "US");
    expect(prompt).toContain("Return up to 12 named HUMAN individuals");
    expect(prompt).toContain("Never construct or infer direct individual emails");
    expect(prompt).toContain("sourceUrls and sources: only real URLs from your search");
  });
});